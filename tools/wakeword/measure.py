"""Measures the wake word the way it will be used: streamed, chunk by chunk, with a threshold.

Over hours of audio with the phrase absent, the count of accepts per hour at each threshold. Over
takes of the phrase, the share missed. Scores are computed once per file and the rule is swept
over them, so choosing a threshold and how many chunks must agree costs nothing extra.
"""

import argparse
import pathlib

import numpy as np
import onnxruntime as ort
import soundfile as sf

from features import CHUNK, RATE, Features, Streamer, as_int16_scale

THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99]
NEEDED = [2, 3]
# Rest after a hearing, the way the sidecar does it.
REST_CHUNKS = 25
# A take ends a moment after the word; in use the audio goes on. Silence is added so the window
# can slide past the word the way it does when someone keeps breathing.
TRAILING = int(1.5 * RATE)


def stream(features: Features, head: ort.InferenceSession, audio: np.ndarray) -> np.ndarray:
    """One probability per chunk, exactly as the sidecar would produce them."""
    scores = []
    streamer = Streamer(features)
    for start in range(0, len(audio) - CHUNK + 1, CHUNK):
        recent = streamer.hear(audio[start:start + CHUNK])
        if recent is None:
            scores.append(0.0)
            continue
        scores.append(float(head.run(None, {"embeddings": recent[None].astype(np.float32)})[0].ravel()[0]))
    return np.array(scores)


def accepts(scores: np.ndarray, threshold: float, needed: int) -> int:
    count, run, rest = 0, 0, 0
    for score in scores:
        if rest > 0:
            rest -= 1
            continue
        run = run + 1 if score >= threshold else 0
        if run >= needed:
            count += 1
            run = 0
            rest = REST_CHUNKS
    return count


def load(path: pathlib.Path) -> np.ndarray:
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate != RATE:
        taken = np.arange(0, len(audio), rate / RATE)
        audio = np.interp(taken, np.arange(len(audio)), audio).astype(np.float32)
    return as_int16_scale(audio)


def files(paths):
    for p in paths:
        yield from (sorted(x for x in p.rglob("*") if x.suffix.lower() in {".wav", ".flac"}) if p.is_dir() else [p])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=pathlib.Path)
    parser.add_argument("--ambient", type=pathlib.Path, nargs="*", default=[], help="files or folders without the phrase")
    parser.add_argument("--spoken", type=pathlib.Path, nargs="*", default=[], help="files or folders, one phrase each")
    parser.add_argument("--label", default="")
    args = parser.parse_args()

    features = Features()
    head = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])

    hours = 0.0
    ambient_scores = []
    for path in files(args.ambient):
        audio = load(path)
        hours += len(audio) / RATE / 3600
        ambient_scores.append(stream(features, head, audio))
    spoken_scores = []
    for path in files(args.spoken):
        audio = np.concatenate([load(path), np.zeros(TRAILING, dtype=np.float32)])
        spoken_scores.append(stream(features, head, audio))

    print(f"== {args.label} ==  ambient {hours:.2f} hours, spoken {len(spoken_scores)} takes")
    for needed in NEEDED:
        print(f"chunks in a row: {needed}")
        print("  threshold  false accepts/hour  false rejects")
        for threshold in THRESHOLDS:
            fa = sum(accepts(s, threshold, needed) for s in ambient_scores)
            fr = sum(1 for s in spoken_scores if accepts(s, threshold, needed) == 0)
            fa_rate = fa / hours if hours else float("nan")
            fr_rate = fr / len(spoken_scores) if spoken_scores else float("nan")
            print(f"     {threshold:.2f}        {fa_rate:8.2f}          {fr_rate:6.1%}")


if __name__ == "__main__":
    main()
