import { LAYERS, type Layer } from "./palette.ts";

/// The views a fist walks: everything, then each layer alone in turn, then everything again. From
/// a mix of layers turned on by hand, the next view is everything, the one a person can name.
export function nextView(shown: Layer[]): Layer | undefined {
  if (shown.length === LAYERS.length) return LAYERS[0];
  if (shown.length !== 1) return undefined;
  return LAYERS[LAYERS.indexOf(shown[0]!) + 1];
}
