# What a wake word is heard through

The two models in front are the feature chain the wake word is heard through, and the third is
the wake word itself.

## melspectrogram.onnx and embedding_model.onnx

Taken from openWakeWord's release 0.5.1, which is where its author publishes them:

    https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx
    https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx
    sha256 ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f  melspectrogram.onnx
    sha256 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f  embedding_model.onnx

The embedding model is Google's speech embedding, published as a TensorFlow Hub module under
Apache-2.0 and converted to ONNX by openWakeWord. The mel spectrogram is an ONNX rendering of
PyTorch's mel spectrogram with fixed parameters, from the same release, under the same licence.
Neither is one of openWakeWord's wake word models, which are licensed non commercially and are
not used here.

openWakeWord's README says two things about these files, and both are kept here as the reason
they are shipped. Its licence section puts all of the project's included pre-trained models under
CC BY-NC-SA 4.0, and gives as the reason the datasets of unknown or restrictive licensing in their
training data: that is the wake word models, which are trained on such data. Its account of how
openWakeWord works describes the embedding model as Google's speech embedding, "provided by Google
as a TFHub module under an Apache-2.0 license", which openWakeWord re-implemented to separate its
parts; the weights are Google's, trained by Google, and openWakeWord added no data to them. The mel
spectrogram has no learned weights at all. Both are therefore taken as Apache-2.0, their notices
are in `THIRD_PARTY_NOTICES.md` at the root, and the README is at
https://github.com/dscripka/openWakeWord#license and #how-does-openwakeword-work.

## The contract between them

    audio                16 kHz mono, float32 holding 16 bit integer values, in 80 ms chunks of 1280
    melspectrogram       in [1, samples]  out [1, 1, frames, 32]   one frame per 10 ms
                         every value is then divided by 10 and 2 is added, which is what the
                         embedding model was trained against
    embedding_model      in [n, 76, 32, 1]  out [n, 1, 1, 96]    a window of 76 frames, taken
                         every 8 frames, so one embedding per 80 ms chunk
    the wake word        in [1, 16, 96]  out [1, 1]              the last sixteen embeddings, about
                         1.3 s of audio, to one probability

Training computes exactly this chain, in `tools/wakeword/features.py`, over the same two files.

## hey_kyuren.onnx

The first of four heads trained on 2026-09-17 and 18 with `tools/wakeword/`, which holds every
step, and the one that ships, for reasons the record of the others below makes plain. Nothing
about it is Apple specific, and no Python runs in the application.

    sha256 6fb1daceb0fac0dfac556b2aec34e05d33db1aae48298c2361e1ac7f6d16dd0e
    in  [1, 16, 96]   the last sixteen embeddings
    out [1, 1]        how sure it is, zero to one

The phrase is "Hey Kyuren", said /hˈA/ /kjˈuɹɛn/, confirmed by ear against the synthesis.

**Positives.** Kokoro (Apache-2.0, the project's own voice) saying four phrasings of the phrase in
twenty four voices and thirty blends of pairs of voices, at five speeds: 1080 clean clips, each put
through four rooms and noises for 4320. The pronunciation was given as IPA, so the synthesiser's
espeak-ng fallback, which is GPL, was never reached. Four voices and every blend containing them,
880 clips, were held out entirely.

**Negatives.** Twelve near misses ("hey Karen", "a cure in time", "hey Siri") and twelve ordinary
sentences in Kyuren's own voice, synthesised and put through the same rooms and noises, 5400 clips;
LibriSpeech dev-clean (CC-BY 4.0), 5.4 hours of read speech; and the point source noises of
OpenSLR 28 (Apache-2.0). 117,895 windows in all. Rooms came from OpenSLR 28's real and simulated
responses; its isotropic room noises were kept out of training so they could be measured against.

**Head.** The sixteen embeddings flattened, a layer of 128 with layer norm, ReLU and dropout, one
output. Weighted binary cross entropy, negatives outnumbering positives many times over and a
confident wrong answer on a negative counted four times, thirty epochs on CPU in minutes.

**Measured**, streamed through `tools/wakeword/measure.py`, which hears exactly as the sidecar
does, with two chunks in a row and two seconds of rest. False accepts are per hour. The speech
heavy set is 6.16 hours without the phrase: LibriSpeech test-clean, continuous read speech, plus
0.76 hours of room noise. The quiet room is 49 minutes of the user's own room, recorded on this
machine and kept out of the repository, at a flat minus thirty five decibels. Missed takes are
over 880 held out synthetic clips and fifty recordings of the user on the same machine.

    threshold   false accepts, speech heavy   false accepts, quiet room   missed, held out   missed, the user
       0.50            10.55                          0                      0.7%               4%
       0.60             ~9                            0                      0.8%               4 to 6%
       0.70             7.14                          0                      0.8%               4%
       0.90             4.22                          0                      0.9%              10%

Shipped at 0.60 first, then 0.70 on 2026-09-18 after five wakes in twenty minutes of a lived-in
room, three of them between 0.71 and 0.72; the ear also refuses a wake unless the voice detector
heard speech within the last 1.5 s, since what woke it was not speech. Continuous speech beside
the machine is its weakness; the room it lives in is not.

**Tried after it, and not shipped.**

The second head added 13,239 windows mined from a hundred hours of LibriSpeech train-clean-100
with the first head. False accepts on the speech heavy set fell to 0.49 an hour at 0.50 and to
none at 0.90, but it missed 34% of the user's takes at 0.50: every real recorded voice in its
training was a negative and every positive synthesised, so it learned the difference between the
two rather than the phrase.

The third head kept those mined windows and added twenty five of the user's recordings as
positives, put through eight rooms and noises and counted three times, with the other twenty five
held out. It missed none of the held out takes at 0.90, and false accepted 0.32 an hour on the
speech heavy set at 0.98 with three chunks agreeing, which looked like the answer and shipped for
an evening. On the quiet room it false accepted 907 times an hour at 0.50 and 2.43 an hour at its
shipped point. The anchors were recorded on this microphone in this room and every negative on
some other; what it learned from them was this microphone's own noise floor. The room recording
was made to catch exactly that, and did.

The fourth head kept the third's positives and mined windows and put the user's room into both
classes: four fifths of the recording cut into 791 three second pieces, used as negatives three
times over and as the noise mixed into positives and negatives alike, with the last fifth held
out. That cured the room, to no false accepts from 0.98 with two chunks and from 0.90 with three,
and the user's held out takes came in at 4% missed. But on the speech heavy set it false accepted
100 times an hour at 0.50 and still 14.61 at 0.98, worse than the first head at every point. Real
positives from one microphone bias a head towards real recorded speech of any kind, and mixing
one room into training answers for that room only. The first head, with no real positives and no
such bias, remains the better trade for a machine that spends most of its time in a quiet room
and some of it beside people talking, and it ships. The way beyond it is real positives from many
speakers and microphones, which do not exist for this phrase.
