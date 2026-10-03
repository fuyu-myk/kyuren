use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use objc2_core_foundation::{CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_io_kit::{
    io_iterator_t, kIOMainPortDefault, IOIteratorNext, IOObjectRelease, IORegistryEntryCreateCFProperty,
    IOServiceGetMatchingServices, IOServiceMatching,
};
use serde::Serialize;
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System};
use tauri::{AppHandle, Emitter};

/// Two minutes of network, a sample a second: what the graph shows.
pub const KEPT: usize = 120;
const TICK: Duration = Duration::from_secs(1);
/// The GPU's count changes on every read, so a second of reads is averaged.
const GPU_READS: u32 = 5;
/// Disk use changes slowly and is slow to read.
const DISK_EVERY: Duration = Duration::from_secs(30);

/// Interfaces whose traffic is not the Mac's own or is counted elsewhere already: loopback, VPN
/// tunnels carrying what Wi-Fi also carries, AirDrop's link, bridges.
const UNCOUNTED: [&str; 9] = ["lo", "utun", "awdl", "llw", "bridge", "gif", "stf", "anpi", "ap"];

pub fn counted(interface: &str) -> bool {
    !UNCOUNTED.iter().any(|prefix| interface.starts_with(prefix))
}

/// Bytes moved over a span, as bytes a second.
pub fn per_second(bytes: u64, elapsed: Duration) -> f64 {
    let seconds = elapsed.as_secs_f64();
    if seconds <= 0.0 {
        0.0
    } else {
        bytes as f64 / seconds
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Traffic {
    pub at: u64,
    pub up: f64,
    pub down: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Disk {
    pub used: u64,
    pub total: u64,
}

/// The machine as last sampled, with the network's recent past for the graph, oldest first.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Snapshot {
    pub cpu: f64,
    pub gpu: Option<f64>,
    pub ram: f64,
    pub disk: Option<Disk>,
    pub traffic: Vec<Traffic>,
}

/// Keeps the last KEPT samples.
pub fn kept(history: &mut VecDeque<Traffic>, sample: Traffic) {
    history.push_back(sample);
    while history.len() > KEPT {
        history.pop_front();
    }
}

/// Which sampler may run. Each start takes a new one and each stop moves it on, so a sampler
/// stopped and started again within its second ends rather than running beside its successor.
static GENERATION: AtomicU64 = AtomicU64::new(0);
static RUNNING: AtomicBool = AtomicBool::new(false);
static WATCHED: AtomicBool = AtomicBool::new(false);

fn latest() -> &'static Mutex<Snapshot> {
    static LATEST: OnceLock<Mutex<Snapshot>> = OnceLock::new();
    LATEST.get_or_init(|| Mutex::new(Snapshot::default()))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_millis() as u64).unwrap_or(0)
}

/// The GPU's own count of how busy it is, from IOKit's accelerator entry. The key is not
/// documented, so its absence is taken as not knowing rather than as idle.
fn gpu_busy() -> Option<f64> {
    // SAFETY: the class name is a nul-terminated literal that outlives the call.
    let matching = unsafe { IOServiceMatching(c"IOAccelerator".as_ptr()) }?;
    let matching = CFRetained::<CFDictionary>::from(&matching);
    let mut iterator: io_iterator_t = 0;
    // SAFETY: the main port is a constant IOKit provides; the dictionary is consumed by the call,
    // and the iterator is a valid place for it to write.
    let result = unsafe { IOServiceGetMatchingServices(kIOMainPortDefault, Some(matching), &mut iterator) };
    if result != 0 || iterator == 0 {
        return None;
    }
    let key = CFString::from_static_str("PerformanceStatistics");
    let busy = CFString::from_static_str("Device Utilization %");
    let mut found = None;
    loop {
        let entry = IOIteratorNext(iterator);
        if entry == 0 {
            break;
        }
        // SAFETY: the entry is live, from the iterator, and released straight after.
        let property = unsafe { IORegistryEntryCreateCFProperty(entry, Some(&key), None, 0) };
        IOObjectRelease(entry);
        let Some(stats) = property.and_then(|property| property.downcast::<CFDictionary>().ok()) else { continue };
        // SAFETY: a performance-statistics dictionary is keyed by strings.
        let stats: CFRetained<CFDictionary<CFString, CFType>> = unsafe { CFRetained::cast_unchecked(stats) };
        let value = stats.get(&busy).and_then(|value| value.downcast::<CFNumber>().ok());
        if let Some(number) = value.and_then(|number| number.as_i64().map(|whole| whole as f64).or_else(|| number.as_f64())) {
            found = Some(number);
            break;
        }
    }
    IOObjectRelease(iterator);
    found
}

fn root_disk(disks: &Disks) -> Option<Disk> {
    let root = disks.list().iter().find(|disk| disk.mount_point() == std::path::Path::new("/"))?;
    let total = root.total_space();
    Some(Disk { used: total.saturating_sub(root.available_space()), total })
}

/// Samples the machine once a second while a widget wants it, and tells the island only while
/// the island is showing it. The GPU is read only then too: it is the one costly to read.
fn sample(app: AppHandle, mine: u64) {
    let mut system = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
            .with_memory(MemoryRefreshKind::nothing().with_ram()),
    );
    let mut networks = Networks::new_with_refreshed_list();
    let mut disks = Disks::new_with_refreshed_list();
    let mut history: VecDeque<Traffic> = VecDeque::with_capacity(KEPT + 1);
    let mut last = Instant::now();
    let mut disk = root_disk(&disks);
    let mut disk_at = Instant::now();
    // The last GPU reading is kept while it is not being read, so a glance just opened shows one.
    let mut last_gpu: Option<f64> = None;

    while GENERATION.load(Ordering::SeqCst) == mine {
        let watched = WATCHED.load(Ordering::SeqCst);
        let mut gpu = Vec::new();
        for _ in 0..GPU_READS {
            std::thread::sleep(TICK / GPU_READS);
            if watched {
                gpu.extend(gpu_busy());
            }
        }
        let elapsed = last.elapsed();
        last = Instant::now();
        system.refresh_cpu_usage();
        system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        networks.refresh(true);
        let (mut up, mut down) = (0u64, 0u64);
        for (name, data) in &networks {
            if counted(name) {
                up += data.transmitted();
                down += data.received();
            }
        }
        if disk_at.elapsed() >= DISK_EVERY {
            disks.refresh(true);
            disk = root_disk(&disks);
            disk_at = Instant::now();
        }
        kept(&mut history, Traffic { at: now_ms(), up: per_second(up, elapsed), down: per_second(down, elapsed) });

        let total = system.total_memory();
        let snapshot = Snapshot {
            cpu: f64::from(system.global_cpu_usage()),
            gpu: if gpu.is_empty() { last_gpu } else { Some(gpu.iter().sum::<f64>() / gpu.len() as f64) },
            ram: if total == 0 { 0.0 } else { system.used_memory() as f64 / total as f64 * 100.0 },
            disk,
            traffic: history.iter().copied().collect(),
        };
        last_gpu = snapshot.gpu;
        if let Ok(mut held) = latest().lock() {
            *held = snapshot.clone();
        }
        if watched {
            let _ = app.emit_to(crate::island::LABEL, "glance:stats", &snapshot);
        }
    }
}

/// Starts sampling if a widget wants it and it is not already, or lets it stop.
pub fn want(app: &AppHandle, on: bool) {
    if !on {
        RUNNING.store(false, Ordering::SeqCst);
        GENERATION.fetch_add(1, Ordering::SeqCst);
        return;
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let mine = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    if std::thread::Builder::new().name("kyuren-stats".into()).spawn(move || sample(handle, mine)).is_err() {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// The machine as last sampled, for a glance that has just opened.
#[tauri::command]
pub fn glance_stats() -> Snapshot {
    latest().lock().map(|held| held.clone()).unwrap_or_default()
}

/// Whether the glance is showing, which is when the island is told every second.
#[tauri::command]
pub fn glance_watch(on: bool) {
    WATCHED.store(on, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_macs_own_traffic_is_counted_once() {
        assert!(counted("en0"));
        assert!(counted("en7"), "a wired adapter counts too");
        for skipped in ["lo0", "utun3", "awdl0", "llw0", "bridge0", "anpi0", "ap1"] {
            assert!(!counted(skipped), "{skipped} is not the Mac's own traffic, or is counted on en0 already");
        }
    }

    #[test]
    fn bytes_over_a_span_become_a_rate_and_history_is_kept_to_two_minutes() {
        assert_eq!(per_second(3_000, Duration::from_millis(1_500)), 2_000.0);
        assert_eq!(per_second(3_000, Duration::ZERO), 0.0, "no time passed is no rate, not infinity");
        let mut history = VecDeque::new();
        for at in 0..(KEPT as u64 + 5) {
            kept(&mut history, Traffic { at, up: 0.0, down: 0.0 });
        }
        assert_eq!(history.len(), KEPT);
        assert_eq!(history.front().map(|one| one.at), Some(5), "the oldest went first");
    }
}
