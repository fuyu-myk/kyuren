"""Trains the wake word: a small head over the embeddings the feature chain gives.

Positives are the phrase, synthesised and put through rooms and noise. Negatives are other speech,
noise, and phrases chosen to sound like the phrase. Every clip becomes its embeddings, every run of
sixteen embeddings becomes one example, and the head learns to say which runs hold the phrase.
The hardest negatives are what decide false accepts, so they are weighted up.
"""

import argparse
import json
import pathlib
import random

import numpy as np
import soundfile as sf
import torch
from torch import nn

from features import EMBEDDING, FRAMES, Features, as_int16_scale

CACHE = pathlib.Path.home() / ".kyuren" / "wakeword" / "features"


def clips(folder: pathlib.Path) -> list[pathlib.Path]:
    return sorted(p for p in folder.rglob("*") if p.suffix.lower() in {".wav", ".flac"})


def embed_all(features: Features, files: list[pathlib.Path], tag: str) -> list[np.ndarray]:
    """Embeddings per clip, cached, because the feature chain is the slow part and never changes."""
    CACHE.mkdir(parents=True, exist_ok=True)
    out = []
    for at, path in enumerate(files):
        kept = CACHE / f"{tag}_{path.stem}_{path.stat().st_size}.npy"
        if kept.exists():
            out.append(np.load(kept))
            continue
        audio, rate = sf.read(path, dtype="float32", always_2d=True)
        audio = audio.mean(axis=1)
        if rate != 16_000:
            taken = np.arange(0, len(audio), rate / 16_000)
            audio = np.interp(taken, np.arange(len(audio)), audio).astype(np.float32)
        got = features.of(as_int16_scale(audio))
        np.save(kept, got)
        out.append(got)
        if at % 200 == 0:
            print(f"  {tag}: {at}/{len(files)}")
    return out


def windows(embeddings: np.ndarray, step: int) -> np.ndarray:
    """Every run of sixteen embeddings, stepping along. A clip too short for sixteen is padded with
    silence in front, which is what the ear hears before a short word is said."""
    if len(embeddings) == 0:
        return np.zeros((0, FRAMES, EMBEDDING), dtype=np.float32)
    if len(embeddings) < FRAMES:
        padded = np.zeros((FRAMES, EMBEDDING), dtype=np.float32)
        padded[FRAMES - len(embeddings):] = embeddings
        return padded[None]
    starts = range(0, len(embeddings) - FRAMES + 1, step)
    return np.stack([embeddings[at:at + FRAMES] for at in starts])


class Head(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Flatten(),
            nn.Linear(FRAMES * EMBEDDING, 128),
            nn.LayerNorm(128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.net(x))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--positive", type=pathlib.Path, required=True, nargs="+")
    parser.add_argument("--negative", type=pathlib.Path, required=True, nargs="+")
    parser.add_argument("--negative-windows", type=pathlib.Path, nargs="*", default=[], help="mined windows, .npy")
    parser.add_argument("--validate", type=pathlib.Path, nargs="*", default=[], help="real positives, held out")
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    features = Features()

    print("embedding positives")
    positive = [w for f in args.positive for e in embed_all(features, clips(f), f"pos_{f.name}") for w in windows(e, 2)]
    print("embedding negatives")
    negative = [w for f in args.negative for e in embed_all(features, clips(f), f"neg_{f.name}") for w in windows(e, 4)]
    for mined in args.negative_windows:
        negative.extend(np.load(mined))
    held = [w for f in args.validate for e in embed_all(features, clips(f), f"val_{f.name}") for w in windows(e, 1)]
    print(f"{len(positive)} positive windows, {len(negative)} negative, {len(held)} held out")

    x = torch.tensor(np.concatenate([np.stack(positive), np.stack(negative)]), dtype=torch.float32)
    y = torch.tensor([1.0] * len(positive) + [0.0] * len(negative), dtype=torch.float32)[:, None]

    head = Head()
    optimiser = torch.optim.AdamW(head.parameters(), lr=1e-3, weight_decay=1e-3)
    # Negatives outnumber positives many times over; a false accept is the worse mistake, so they
    # are not merely balanced, the hard ones are pushed on.
    weight = torch.where(y == 1, torch.tensor(len(negative) / len(positive)), torch.tensor(1.0)).clamp(max=20)
    loss_fn = nn.BCELoss(reduction="none")

    order = torch.randperm(len(x))
    batch = 512
    for epoch in range(args.epochs):
        head.train()
        total = 0.0
        for start in range(0, len(x), batch):
            picked = order[start:start + batch]
            optimiser.zero_grad()
            out = head(x[picked])
            loss = loss_fn(out, y[picked])
            # Hard negatives: a confident wrong answer counts for more.
            hard = torch.where((y[picked] == 0) & (out > 0.3), torch.tensor(4.0), torch.tensor(1.0))
            loss = (loss * weight[picked] * hard).mean()
            loss.backward()
            optimiser.step()
            total += float(loss) * len(picked)
        head.eval()
        with torch.no_grad():
            neg = head(x[len(positive):]).squeeze(1)
            pos = head(x[:len(positive)]).squeeze(1)
            fa = float((neg > 0.5).float().mean())
            tp = float((pos > 0.5).float().mean())
            line = f"epoch {epoch + 1:2d} loss {total / len(x):.4f} recall {tp:.3f} false accept {fa:.4f}"
            if held:
                real = head(torch.tensor(np.stack(held), dtype=torch.float32)).squeeze(1)
                line += f" held out recall {float((real > 0.5).float().mean()):.3f}"
            print(line)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    head.eval()
    torch.onnx.export(
        head,
        torch.zeros(1, FRAMES, EMBEDDING),
        str(args.out),
        input_names=["embeddings"],
        output_names=["probability"],
        dynamic_axes={"embeddings": {0: "batch"}, "probability": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    (args.out.with_suffix(".json")).write_text(json.dumps({
        "positive_windows": len(positive),
        "negative_windows": len(negative),
        "held_out_windows": len(held),
        "epochs": args.epochs,
    }, indent=2))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
