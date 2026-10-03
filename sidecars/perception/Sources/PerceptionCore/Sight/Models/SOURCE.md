# Hand tracking models

Two models, taken from Google's own storage and converted once. They are committed rather than
fetched at run time so that the sidecar needs neither the network nor a Python toolchain to start.

Source bundle, MediaPipe hand landmarker, float16, revision 1, Apache-2.0, Copyright Google LLC:

    https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
    sha256 fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1

The bundle is a zip holding `hand_detector.tflite` and `hand_landmarks_detector.tflite`. Both were
converted with `tf2onnx` at opset 17, with no unsupported operations:

    python -m tf2onnx.convert --tflite hand_detector.tflite --output hand_detector.onnx --opset 17
    python -m tf2onnx.convert --tflite hand_landmarks_detector.tflite --output hand_landmarks_detector.onnx --opset 17

    sha256 3d0638f946a77df5c788cf2a0c877cf1d72f276326ef3708df47f16abca4f3f8  hand_detector.onnx
    sha256 70f0e8a5667600e042467520a069ef1c1507f169e81b0ae7d36bf85754e7697e  hand_landmarks_detector.onnx

## What they take and give back

    hand_detector            in  1x192x192x3
                             out 1x2016x18   four box coordinates and seven palm keypoints
                                 1x2016x1    one score per anchor

    hand_landmarks_detector  in  1x224x224x3
                             out 1x63        twenty one landmarks, x y and z
                                 1x1         whether a hand is present
                                 1x1         which hand it is
                                 1x63        the same landmarks in metric space

The presence score is the one that matters. Reading a hand from per joint confidences means
choosing a threshold for every joint and being wrong about each of them separately.
