"""Says a phrase in many voices, for training a wake word.

The phrase is given with its pronunciation spelled out, so the synthesiser never has to guess at a
name it has not seen and never reaches for its fallback dictionary to do so. Output is 16 kHz mono,
which is what the detector listens at.
"""

import argparse
import pathlib
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline

RATE = 16_000
KOKORO_RATE = 24_000

# American and British voices of both kinds. The point is spread, not beauty.
VOICES = [
    "af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "af_alloy", "af_aoede", "af_jessica",
    "am_adam", "am_michael", "am_echo", "am_eric", "am_liam", "am_onyx", "am_puck", "am_fenrir",
    "bf_emma", "bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_lewis", "bm_daniel", "bm_fable",
]


def resampled(audio: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
    if from_rate == to_rate:
        return audio
    taken = np.arange(0, len(audio), from_rate / to_rate)
    return np.interp(taken, np.arange(len(audio)), audio).astype(np.float32)


def say(pipeline: KPipeline, marked: str, voice, speed: float) -> np.ndarray:
    pieces = [np.asarray(piece.audio) for piece in pipeline(marked, voice=voice, speed=speed)]
    return resampled(np.concatenate(pieces).astype(np.float32), KOKORO_RATE, RATE)


def blends(pipeline: KPipeline, names: list[str], count: int, seed: int):
    """Voices between two voices. Two dozen speakers is not many; mixing pairs makes more, and a
    wake word has to work for people who sound like none of the two dozen."""
    import random
    import torch
    random.seed(seed)
    out = []
    for _ in range(count):
        one, other = random.sample(names, 2)
        weight = random.uniform(0.3, 0.7)
        mixed = pipeline.load_voice(one) * weight + pipeline.load_voice(other) * (1 - weight)
        out.append((f"{one}-{other}-{int(weight * 100)}", mixed))
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phrases", nargs="+", help="with pronunciations, e.g. '[Hey](/hˈA/) [Kyuren](/kjˈuɹɛn/)'")
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--voices", nargs="*", default=VOICES)
    parser.add_argument("--blends", type=int, default=0, help="extra speakers mixed from pairs of voices")
    parser.add_argument("--speeds", nargs="*", type=float, default=[0.85, 1.0, 1.15])
    parser.add_argument("--name", default="clip")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    pipelines = {lang: KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M") for lang in ("a", "b")}
    speakers = [(name, name, "b" if name.startswith("b") else "a") for name in args.voices]
    speakers += [(label, tensor, "a") for label, tensor in blends(pipelines["a"], args.voices, args.blends, args.seed)]

    made = 0
    for which, phrase in enumerate(args.phrases):
        for label, voice, lang in speakers:
            for speed in args.speeds:
                try:
                    audio = say(pipelines[lang], phrase, voice, speed)
                except Exception as failure:
                    print(f"{label} at {speed}: {failure}", file=sys.stderr)
                    continue
                sf.write(args.out / f"{args.name}_{which}_{label}_{speed:.2f}.wav", audio, RATE, subtype="PCM_16")
                made += 1
    print(f"wrote {made} clips to {args.out}")


if __name__ == "__main__":
    main()
