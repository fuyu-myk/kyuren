"""Records the microphone to a file, for measuring the wake word against real rooms and real voices.

Two uses. Ambient: leave it running while nothing in particular happens, to count false accepts.
Spoken: say the wake word once per prompt, at a few distances, to count false rejects. Files are
written under ~/.kyuren/wakeword and never belong in the repository.
"""

import argparse
import pathlib
import time

import numpy as np
import sounddevice as sd
import soundfile as sf

RATE = 16_000
HOME = pathlib.Path.home() / ".kyuren" / "wakeword"


def ambient(minutes: float, out: pathlib.Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    print(f"recording {minutes:g} minutes of the room to {out}; ctrl-c to stop early")
    with sf.SoundFile(out, mode="w", samplerate=RATE, channels=1, subtype="PCM_16") as file:
        def keep(indata, frames, at, status):
            file.write(indata[:, 0])
        with sd.InputStream(samplerate=RATE, channels=1, dtype="float32", callback=keep):
            try:
                time.sleep(minutes * 60)
            except KeyboardInterrupt:
                pass
    print("done")


def spoken(count: int, out: pathlib.Path, seconds: float) -> None:
    out.mkdir(parents=True, exist_ok=True)
    print(f"{count} takes, {seconds:g} seconds each. Say the wake word once per take, and vary how")
    print("far you are and how you say it. A take you fluffed can be deleted afterwards.")
    for take in range(1, count + 1):
        input(f"  take {take}/{count}: press return, then speak")
        audio = sd.rec(int(seconds * RATE), samplerate=RATE, channels=1, dtype="float32")
        sd.wait()
        path = out / f"take_{take:03d}.wav"
        sf.write(path, audio[:, 0], RATE, subtype="PCM_16")
        print(f"    kept {path.name}")
    print("done")


def main() -> None:
    parser = argparse.ArgumentParser()
    what = parser.add_subparsers(dest="what", required=True)

    room = what.add_parser("ambient", help="the room, with nothing in particular happening")
    room.add_argument("--minutes", type=float, default=60)
    room.add_argument("--out", type=pathlib.Path, default=HOME / "ambient" / f"{int(time.time())}.wav")

    said = what.add_parser("spoken", help="the wake word, once per take")
    said.add_argument("--takes", type=int, default=50)
    said.add_argument("--seconds", type=float, default=3)
    said.add_argument("--out", type=pathlib.Path, default=HOME / "spoken")

    args = parser.parse_args()
    if args.what == "ambient":
        ambient(args.minutes, args.out)
    else:
        spoken(args.takes, args.out, args.seconds)


if __name__ == "__main__":
    main()
