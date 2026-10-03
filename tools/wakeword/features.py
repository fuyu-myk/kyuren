"""The feature chain a wake word is heard through, computed over the very files the sidecar ships.

Sixteen kilohertz audio in eighty millisecond chunks becomes one 96 value embedding per chunk, and
the wake word is judged on the last sixteen of them. The sidecar computes this in Swift; this is
the same arithmetic in Python, and the two are held to each other by a test on both sides.
"""

import pathlib

import numpy as np
import onnxruntime as ort

RATE = 16_000
CHUNK = 1280
MEL_WINDOW = 76
MEL_STEP = 8
FRAMES = 16
EMBEDDING = 96

MODELS = (
    pathlib.Path(__file__).resolve().parents[2]
    / "sidecars" / "perception" / "Sources" / "PerceptionCore" / "Audio" / "Hearing"
)


class Features:
    def __init__(self) -> None:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.mel = ort.InferenceSession(str(MODELS / "melspectrogram.onnx"), options, providers=["CPUExecutionProvider"])
        self.embed = ort.InferenceSession(str(MODELS / "embedding_model.onnx"), options, providers=["CPUExecutionProvider"])

    def mels(self, audio: np.ndarray) -> np.ndarray:
        """One 32 band frame per 10 ms. Audio is float32 holding 16 bit integer values."""
        raw = self.mel.run(None, {"input": audio.astype(np.float32)[None, :]})[0]
        return raw.reshape(-1, 32) / 10 + 2

    def embeddings(self, mels: np.ndarray) -> np.ndarray:
        """One embedding per 80 ms: a 76 frame window taken every 8 frames."""
        starts = range(0, len(mels) - MEL_WINDOW + 1, MEL_STEP)
        if not starts:
            return np.zeros((0, EMBEDDING), dtype=np.float32)
        windows = np.stack([mels[at:at + MEL_WINDOW] for at in starts])[..., None].astype(np.float32)
        return self.embed.run(None, {"input_1": windows})[0].reshape(-1, EMBEDDING)

    def of(self, audio: np.ndarray) -> np.ndarray:
        # A clip shorter than one window of frames yields nothing, and one shorter than a single
        # mel frame is refused outright. Silence is added to the end so every clip yields at least
        # one embedding; for a burst of noise a few milliseconds long that is also the truth.
        least = MEL_WINDOW * 160 + 512
        if len(audio) < least:
            audio = np.concatenate([audio, np.zeros(least - len(audio), dtype=np.float32)])
        return self.embeddings(self.mels(audio))


TAIL = 480
PADDED = 3


class Streamer:
    """Hears a clip the way the sidecar does: chunk by chunk, with three hops of the previous chunk
    in front of each new one, so the frames land on the very grid a whole clip gives in one pass.
    Measurement runs through this so that what is measured is what will run."""

    def __init__(self, features: Features) -> None:
        self.features = features
        self.tail = np.zeros(TAIL, dtype=np.float32)
        self.primed = False
        self.frames = np.zeros((0, 32), dtype=np.float32)
        self.consumed = 0
        self.embeddings: list[np.ndarray] = []

    def hear(self, chunk: np.ndarray) -> np.ndarray | None:
        """The last sixteen embeddings after this chunk, once there are sixteen."""
        fresh = self.features.mels(np.concatenate([self.tail, chunk]))
        if not self.primed:
            fresh = fresh[PADDED:]
            self.primed = True
        self.tail = chunk[-TAIL:]
        self.frames = np.concatenate([self.frames, fresh])
        while len(self.frames) - self.consumed >= MEL_WINDOW:
            window = self.frames[self.consumed:self.consumed + MEL_WINDOW]
            self.embeddings.append(self.features.embed.run(None, {"input_1": window[None, ..., None].astype(np.float32)})[0].reshape(-1))
            self.consumed += MEL_STEP
        if self.consumed > MEL_WINDOW + MEL_STEP * 4:
            drop = self.consumed - (MEL_WINDOW + MEL_STEP * 4)
            self.frames = self.frames[drop:]
            self.consumed -= drop
        if len(self.embeddings) > FRAMES * 2:
            del self.embeddings[:-FRAMES * 2]
        if len(self.embeddings) < FRAMES:
            return None
        return np.stack(self.embeddings[-FRAMES:])


def as_int16_scale(audio: np.ndarray) -> np.ndarray:
    """Clips read as floats in minus one to one are put on the scale the chain expects."""
    return np.clip(audio, -1, 1).astype(np.float32) * 32767


def golden() -> None:
    """Prints values a Swift test must reproduce, from a signal it can make for itself."""
    seconds = np.arange(CHUNK * FRAMES) / RATE
    tone = 3000 * np.sin(2 * np.pi * 440 * seconds) + 1200 * np.sin(2 * np.pi * 1730 * seconds + 0.3)
    got = Features().of(tone.astype(np.float32))
    print(f"embeddings: {got.shape}")
    print("first four of the first:", [round(float(v), 5) for v in got[0, :4]])
    print("first four of the last: ", [round(float(v), 5) for v in got[-1, :4]])
    print("sum of all:", round(float(got.sum()), 3))


if __name__ == "__main__":
    golden()
