"""Makes each clean clip into several the way a room would hear it.

A clip is convolved with a real room's impulse response, mixed with noise at a range of levels,
shifted in time and in gain. What comes out is what a microphone across a room would have caught,
which is what the wake word has to work from.
"""

import argparse
import pathlib
import random

import numpy as np
import soundfile as sf

from features import RATE, as_int16_scale

DATA = pathlib.Path.home() / ".kyuren" / "wakeword" / "data"


def load(path: pathlib.Path) -> np.ndarray:
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate != RATE:
        taken = np.arange(0, len(audio), rate / RATE)
        audio = np.interp(taken, np.arange(len(audio)), audio).astype(np.float32)
    return audio


def listed(name: str) -> list[pathlib.Path]:
    """The rooms and noises come with lists naming which file is which; the file names alone do
    not say."""
    lines = (DATA / "RIRS_NOISES" / "real_rirs_isotropic_noises" / name).read_text().splitlines()
    return [DATA / line.split()[-1] for line in lines if line.strip()]


def rooms() -> list[pathlib.Path]:
    """Every real room response, and a few hundred simulated ones out of sixty thousand. The
    isotropic room noises that come with them are left out, so they can be measured against."""
    simulated = sorted((DATA / "RIRS_NOISES" / "simulated_rirs").rglob("*.wav"))
    random.seed(11)
    return listed("rir_list") + random.sample(simulated, min(600, len(simulated)))


def noises(extra: list[pathlib.Path] | None = None) -> list[pathlib.Path]:
    """The point source noises, and any folders of the user's own room. Mixing the room into both
    classes is what keeps a head from learning the room as the phrase."""
    found = sorted((DATA / "RIRS_NOISES" / "pointsource_noises").glob("*.wav"))
    for folder in extra or []:
        found += sorted(folder.glob("*.wav"))
    return found


def in_room(audio: np.ndarray, room: np.ndarray) -> np.ndarray:
    room = room[: RATE // 2]
    room = room / (np.abs(room).max() + 1e-6)
    wet = np.convolve(audio, room)[: len(audio)]
    return wet / (np.abs(wet).max() + 1e-6) * (np.abs(audio).max() + 1e-6)


def with_noise(audio: np.ndarray, noise: np.ndarray, snr_db: float) -> np.ndarray:
    if len(noise) < len(audio):
        noise = np.tile(noise, len(audio) // len(noise) + 1)
    start = random.randrange(0, len(noise) - len(audio) + 1)
    piece = noise[start:start + len(audio)]
    signal = np.sqrt(np.mean(audio**2)) + 1e-6
    wanted = signal / (10 ** (snr_db / 20))
    piece = piece / (np.sqrt(np.mean(piece**2)) + 1e-6) * wanted
    return audio + piece


def placed(audio: np.ndarray, seconds: float) -> np.ndarray:
    """Put somewhere inside a fixed length of silence, so the word is not always at the start."""
    length = int(seconds * RATE)
    if len(audio) >= length:
        return audio[:length]
    start = random.randrange(0, length - len(audio) + 1)
    out = np.zeros(length, dtype=np.float32)
    out[start:start + len(audio)] = audio
    return out


def variants(audio: np.ndarray, count: int, room_list, noise_list, seconds: float) -> list[np.ndarray]:
    made = []
    for _ in range(count):
        out = audio * random.uniform(0.3, 1.0)
        if room_list and random.random() < 0.7:
            out = in_room(out, load(random.choice(room_list)))
        if noise_list and random.random() < 0.8:
            out = with_noise(out, load(random.choice(noise_list)), random.uniform(0, 25))
        made.append(np.clip(placed(out, seconds), -1, 1))
    return made


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("out", type=pathlib.Path)
    parser.add_argument("--each", type=int, default=4)
    parser.add_argument("--seconds", type=float, default=2.0)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--noise-dir", type=pathlib.Path, nargs="*", default=[], help="folders of extra noise, such as the user's room")
    args = parser.parse_args()

    random.seed(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    room_list, noise_list = rooms(), noises(args.noise_dir)
    print(f"{len(room_list)} rooms, {len(noise_list)} noises")
    made = 0
    for clip in sorted(args.source.glob("*.wav")):
        for which, variant in enumerate(variants(load(clip), args.each, room_list, noise_list, args.seconds)):
            sf.write(args.out / f"{clip.stem}_{which}.wav", variant, RATE, subtype="PCM_16")
            made += 1
    print(f"wrote {made} clips to {args.out}")


if __name__ == "__main__":
    main()
