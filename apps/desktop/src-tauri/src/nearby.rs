use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use tauri::Url;

/// Endings of names that only ever lead to this machine or the network it sits on.
const NEARBY_ENDINGS: [&str; 5] = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

fn nearby_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    // Shared address space, where a carrier's or a mesh network's machines sit, is not public either.
    ip.is_loopback() || ip.is_private() || ip.is_link_local() || a == 0 || (a == 100 && (64..=127).contains(&b))
}

fn nearby_v6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    // Unspecified, loopback, and a v4 address written as v6, which could be any of the above.
    let v4_inside = segments[..5] == [0; 5] && (segments[5] == 0 || segments[5] == 0xffff);
    v4_inside || (segments[0] & 0xfe00) == 0xfc00 || (segments[0] & 0xffc0) == 0xfe80
}

/// A network this machine is on: an address of its own there, and how many leading bits name the
/// network.
pub type Network = (IpAddr, u32);

/// The widest masks taken for a network at all: one any wider, misreported say, would make every
/// address nearby.
const WIDEST_V4: u32 = 8;
const WIDEST_V6: u32 = 32;

fn prefix_of(mask: &[u8]) -> u32 {
    mask.iter().map(|byte| byte.count_ones()).sum()
}

/// Every network this machine is on, its own public ones included: on a network with public
/// addresses, the router and everything beside it are as near as anything private.
pub fn networks() -> Vec<Network> {
    let mut found = Vec::new();
    let mut all: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs fills the pointer with a list it allocates, freed below.
    if unsafe { libc::getifaddrs(&mut all) } != 0 {
        eprintln!("kyuren nearby: this machine's networks could not be read, so only its fixed ranges count");
        return found;
    }
    let mut at = all;
    while !at.is_null() {
        // SAFETY: a node of the list getifaddrs made, alive until the list is freed.
        let node = unsafe { &*at };
        if !node.ifa_addr.is_null() && !node.ifa_netmask.is_null() {
            // SAFETY: an address and its mask the system wrote, read as the family the address says.
            unsafe {
                match i32::from((*node.ifa_addr).sa_family) {
                    libc::AF_INET => {
                        let inet = &*(node.ifa_addr as *const libc::sockaddr_in);
                        let mask = &*(node.ifa_netmask as *const libc::sockaddr_in);
                        let address = Ipv4Addr::from(u32::from_be(inet.sin_addr.s_addr));
                        found.push((IpAddr::V4(address), prefix_of(&mask.sin_addr.s_addr.to_ne_bytes())));
                    }
                    libc::AF_INET6 => {
                        let inet = &*(node.ifa_addr as *const libc::sockaddr_in6);
                        let mask = &*(node.ifa_netmask as *const libc::sockaddr_in6);
                        found.push((IpAddr::V6(Ipv6Addr::from(inet.sin6_addr.s6_addr)), prefix_of(&mask.sin6_addr.s6_addr)));
                    }
                    _ => {}
                }
            }
        }
        at = node.ifa_next;
    }
    // SAFETY: the list getifaddrs made, freed once, after its last use.
    unsafe { libc::freeifaddrs(all) };
    found
}

/// Whether an address is on a network: the same as the network's own address in its leading bits.
pub fn holds(network: &Network, ip: IpAddr) -> bool {
    let (own, prefix) = *network;
    if own == ip {
        return true;
    }
    match (own, ip) {
        (IpAddr::V4(own), IpAddr::V4(other)) if (WIDEST_V4..=32).contains(&prefix) => {
            let mask = u32::MAX << (32 - prefix);
            u32::from(own) & mask == u32::from(other) & mask
        }
        (IpAddr::V6(own), IpAddr::V6(other)) if (WIDEST_V6..=128).contains(&prefix) => {
            let mask = u128::MAX << (128 - prefix);
            u128::from(own) & mask == u128::from(other) & mask
        }
        _ => false,
    }
}

/// Whether an address is on this machine or the network it sits on, judged as the core judges one
/// before any page is asked for. A public name is not looked up, so one that leads home anyway is
/// beyond what this can tell.
pub fn nearby(url: &Url) -> bool {
    url.host_str().is_none_or(nearby_host)
}

/// Whether a host, as an address writes it, is this machine or its network by its name alone, or
/// by the address it is.
pub fn nearby_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']').trim_end_matches('.').to_ascii_lowercase();
    match host.parse::<IpAddr>() {
        Ok(ip) => nearby_ip(ip),
        // A name of one word is found through the network's own search domains, never the public web's.
        Err(_) => !host.contains('.') || NEARBY_ENDINGS.iter().any(|ending| host.ends_with(ending)),
    }
}

/// Whether an address is this machine, one of its own, or on the network it sits on.
pub fn nearby_ip(ip: IpAddr) -> bool {
    nearby_among(ip, &networks())
}

/// As nearby_ip, given this machine's networks once for many addresses.
pub fn nearby_among(ip: IpAddr, networks: &[Network]) -> bool {
    let near = match ip {
        IpAddr::V4(v4) => nearby_v4(v4),
        IpAddr::V6(v6) => nearby_v6(v6),
    };
    near || networks.iter().any(|network| holds(network, ip))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(address: &str) -> bool {
        nearby(&Url::parse(address).expect("an address"))
    }

    #[test]
    fn this_machine_and_its_network_are_nearby_by_name_or_address() {
        for address in [
            "http://localhost/",
            "http://localhost./",
            "http://router/",
            "http://nas./",
            "http://app.localhost/",
            "http://printer.local/",
            "http://router.lan/",
            "http://nas.home.arpa/",
            "http://metadata.google.internal/",
            "http://127.0.0.1/",
            "http://2130706433/",
            "http://0.0.0.0/",
            "http://10.1.2.3/",
            "http://172.16.4.4/",
            "http://192.168.0.5/",
            "http://169.254.169.254/",
            "http://100.100.100.100/",
            "http://[::1]/",
            "http://[::]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[fd12:3456::1]/",
            "http://[fe80::1]/",
        ] {
            assert!(at(address), "{address} was let through");
        }
    }

    #[test]
    fn an_address_on_a_network_this_machine_is_on_is_nearby_however_public_its_range() {
        let home: Network = ("2001:db8:1234:5678::abcd".parse().expect("an address"), 64);
        assert!(holds(&home, "2001:db8:1234:5678::1".parse().expect("an address")), "the router");
        assert!(!holds(&home, "2001:db8:1234:5679::1".parse().expect("an address")), "the next network over");
        let office: Network = ("203.0.113.40".parse().expect("an address"), 24);
        assert!(holds(&office, "203.0.113.1".parse().expect("an address")));
        assert!(!holds(&office, "203.0.114.1".parse().expect("an address")));
        let wide: Network = ("2001:db8::1".parse().expect("an address"), 0);
        assert!(!holds(&wide, "2606:4700::1111".parse().expect("an address")), "a mask too wide to be a network is no network");
        for (address, prefix) in networks() {
            assert!(nearby_ip(address), "{address}/{prefix}");
        }
    }

    #[test]
    fn every_address_this_machine_answers_at_is_nearby() {
        let own: Vec<IpAddr> = networks().into_iter().map(|(address, _)| address).collect();
        assert!(!own.is_empty());
        for address in own {
            let host = match address {
                IpAddr::V4(ip) => ip.to_string(),
                IpAddr::V6(ip) => format!("[{ip}]"),
            };
            assert!(at(&format!("http://{host}/")), "{host} was let through");
        }
    }

    #[test]
    fn the_public_web_is_not_nearby_whatever_its_names_start_with() {
        for address in [
            "https://example.com/",
            "https://fdic.gov/",
            "https://8.8.8.8/",
            "https://172.32.0.1/",
            "https://[2606:4700::1111]/",
            "https://localhost.example.com/",
        ] {
            assert!(!at(address), "{address} was refused");
        }
    }
}
