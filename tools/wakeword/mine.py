"""Finds the negatives that matter: the moments in hours of ordinary speech that the current head
mistakes for the phrase, or nearly does.

A hundred hours of speech is a million windows, most of them nothing like the phrase and no use
to train on. The head itself says which few thousand are, and those, with a thin random sample of
the rest, become the next head's negatives.
"""

import argparse
import pathlib
import random

import numpy as np
import onnxruntime as ort

from features import EMBEDDING, FRAMES, Features
from train import clips, embed_all, windows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=pathlib.Path, help="the head that does the mistaking")
    parser.add_argument("source", type=pathlib.Path, nargs="+", help="folders of speech without the phrase")
    parser.add_argument("--out", type=pathlib.Path, required=True, help="where the mined windows go, .npy")
    parser.add_argument("--hard", type=float, default=0.02, help="a window scoring above this is worth keeping")
    parser.add_argument("--sample", type=float, default=0.03, help="share of the easy windows kept anyway")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    random.seed(args.seed)
    features = Features()
    head = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])

    kept: list[np.ndarray] = []
    seen = hard = 0
    for folder in args.source:
        for embeddings in embed_all(features, clips(folder), f"mine_{folder.name}"):
            block = windows(embeddings, 8)
            if len(block) == 0:
                continue
            # One at a time: the shipped head has a batch of one, because the sidecar never asks
            # about more than one window, and a head is judged as it will be used.
            scores = [float(head.run(None, {"embeddings": window[None].astype(np.float32)})[0].ravel()[0]) for window in block]
            for window, score in zip(block, scores):
                seen += 1
                if score > args.hard:
                    hard += 1
                    kept.append(window)
                elif random.random() < args.sample:
                    kept.append(window)

    stacked = np.stack(kept).astype(np.float32) if kept else np.zeros((0, FRAMES, EMBEDDING), np.float32)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.save(args.out, stacked)
    print(f"looked at {seen} windows, {hard} were hard, kept {len(stacked)} to {args.out}")


if __name__ == "__main__":
    main()
