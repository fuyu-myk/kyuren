import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Presence, smoothstep } from "@/mind/presence";
import { askable, insideTauri, onHand, onHandLost, onSight, onStep, onStepDone, readGraph, runCapability, startVision, stopVision, toggleMind } from "@/mind/graph";
import { drawHand } from "@/mind/cursor";
import { Holding } from "@/mind/hold";
import { onto, Reaching, type Reading } from "@/mind/reach";
import { Mind, MIDDLE, spanOf } from "@/mind/mind";
import { colourOf, INK, LAYERS, shade, type Layer } from "@/mind/palette";
import { nextView } from "@/mind/views";
import { draw, nodeAt, type Drawn } from "@/mind/render";
import type { Node } from "@/mind/simulation";
import { Screen } from "@/mind/screen";
import { coast, drift, reach, spun, tipped, zoomed, START, type Camera, type Point } from "@/mind/space";

const canvas = document.querySelector<HTMLCanvasElement>("#mind")!;
const layersPanel = document.querySelector<HTMLElement>("#layers")!;
const reading = document.querySelector<HTMLElement>("#reading")!;
const leaving = document.querySelector<HTMLElement>("#leaving")!;
const paint = canvas.getContext("2d")!;

const mind = new Mind();
const presence = new Presence();
const screen = new Screen();

let camera: Camera = START;
let speed = 0;
let size = { width: 0, height: 0 };

/// Seconds since this window started drawing, how present the whirlpool is, and when it was told
/// to go. Being dismissed is the arrival run backwards: orbs are drawn back into Kyuren, last
/// first, and only once they are gone does the dim over the screen lift.
let moment = 0;
let shown = 0;
let left: number | undefined;
let gone = false;
let bloomed = -Infinity;
let staged: Node[] = [];
const FADE = 4;
const HOLD = 0.32;
const SHED = 0.34;

/// How far a drag turns the whirlpool and lifts the eye over it, for a pointer crossing the whole
/// window. Enough to get all the way round without being hard to aim.
const SWING = 0.007;
const TIP = 0.004;

let dragging: { id?: string; from: Point; moved: boolean } | undefined;

/// How far a hand may miss an orb and still be taken to have meant it. A hand held in the air
/// cannot be aimed to the pixel, and an orb is ten pixels across, so without this only the thing
/// in the middle is ever caught.
const REACH = 34;

const reaching = new Reaching();
const holding = new Holding();
let seeing = false;
let open = false;
let hand: Point | undefined;
let bones: Point[] | undefined;
let others: Point[] | undefined;
let pinching = 0;
let grabbed: string | undefined;
function resize(): void {
  const ratio = window.devicePixelRatio || 1;
  size = { width: window.innerWidth, height: window.innerHeight };
  canvas.width = size.width * ratio;
  canvas.height = size.height * ratio;
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  paint.setTransform(ratio, 0, 0, ratio, 0, 0);
  mind.fill(spanOf(size));
}

function pointer(event: PointerEvent | WheelEvent): Point {
  const box = canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/// Joints arrive as a flat run of numbers, two to a joint.
function pairs(flat: number[]): Point[] {
  const points: Point[] = [];
  for (let at = 0; at + 1 < flat.length; at += 2) points.push({ x: flat[at]!, y: flat[at + 1]! });
  return points;
}

function risen(id: string): number {
  return presence.of(id, moment);
}

/// Asks the whirlpool to go. Everything on screen is sent away, last first, and the window puts
/// itself away once the last of it has gone.
function close(): void {
  if (left !== undefined) return;
  watch(false);
  left = moment;
  presence.dismiss(staged.map((one) => one.id), moment);
}

/// Where the hand is and what it is asking for. The pointer is untouched by any of this: both
/// end up calling the same few things on the mind, so one is never waiting on the other.
function felt(seen: Reading | undefined): void {
  // Judged by the camera rather than by what was asked for. If the two ever disagree, the one
  // that is actually running is the one the window has to believe.
  if (!open || left !== undefined) return;

  const intent = reaching.saw(seen);
  hand = reaching.aim ? onto(reaching.aim, size) : undefined;
  bones = seen ? pairs(seen.hand).map((joint) => onto(joint, size)) : undefined;
  others = seen?.other ? pairs(seen.other.hand).map((joint) => onto(joint, size)) : undefined;
  pinching = seen?.pinch ?? 0;
  // The other hand's raised finger holds the graph still: what is lit stays lit, and the aiming
  // hand may move things but chooses nothing new until the finger comes down.
  const held = holding.saw(seen);

  switch (intent.act) {
    case "grab": {
      const node = nodeAt(onto(intent.at, size), staged, mind.drawn(), screen, camera, risen, REACH);
      grabbed = node?.id;
      if (grabbed && !held) focus(grabbed === MIDDLE ? undefined : grabbed);
      break;
    }
    case "move": {
      const held = grabbed ? mind.node(grabbed) : undefined;
      const spot = held ? reach(onto(intent.at, size), held.lift, camera, size) : undefined;
      if (grabbed && spot) mind.hold(grabbed, spot.x, spot.y);
      break;
    }
    case "drop": {
      if (grabbed) mind.release(grabbed);
      grabbed = undefined;
      break;
    }
    case "read": {
      if (held) break;
      const node = nodeAt(onto(intent.at, size), staged, mind.drawn(), screen, camera, risen, REACH);
      // Pointing at nothing is unselecting, the same as clicking nothing. The middle counts as
      // nothing here too: it is the whole, not something to read.
      const chosen = node && node.id !== MIDDLE ? node.id : undefined;
      if (chosen !== mind.focused) focus(chosen);
      break;
    }
    case "layer": {
      view(nextView(mind.layers()));
      break;
    }
  }
}

/// Opening and closing the camera. Nothing else in the window may do it, so there is one place
/// that knows whether it is on and one place that says so.
function watch(on: boolean): void {
  if (on) {
    if (seeing) return;
    seeing = true;
    void startVision()
      .then((running) => {
        open = running;
        drawLayers();
      })
      .catch(() => {
        seeing = false;
        open = false;
        drawLayers();
      });
    drawLayers();
    return;
  }

  seeing = false;
  letGoOfHand();
  // Asked for every time, never skipped because the window believes it is already off. A camera
  // left running on a wrong belief is the one failure this cannot have.
  void stopVision().catch(() => {});
  drawLayers();
}

function letGoOfHand(): void {
  reaching.forget();
  holding.forget();
  hand = undefined;
  bones = undefined;
  others = undefined;
  pinching = 0;
  if (grabbed) mind.release(grabbed);
  grabbed = undefined;
}

/// Escape asks for the mind to be put away, which is the same request the hotkey and the tray item
/// make. It closes here too rather than only asking, so the way out never waits on a round trip.
function dismiss(): void {
  if (left !== undefined) return;
  close();
  if (insideTauri()) void toggleMind().catch(() => {});
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  speed = 0;
  const at = pointer(event);
  const node = nodeAt(at, staged, mind.drawn(), screen, camera, risen);
  dragging = { id: node?.id, from: at, moved: false };
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const at = pointer(event);
  if (Math.hypot(at.x - dragging.from.x, at.y - dragging.from.y) > 3) dragging.moved = true;

  if (dragging.id) {
    // An orb is taken hold of on the surface it sits on, so it follows the pointer rather than
    // sliding away from it wherever the whirlpool happens to be turned to.
    const held = mind.node(dragging.id);
    const spot = held ? reach(at, held.lift, camera, size) : undefined;
    if (spot) mind.hold(dragging.id, spot.x, spot.y);
    return;
  }

  const swing = -(at.x - dragging.from.x) * SWING;
  camera = tipped(spun(camera, swing), (at.y - dragging.from.y) * TIP);
  speed = swing;
  dragging.from = at;
});

function letGo(event: PointerEvent): void {
  if (!dragging) return;
  if (dragging.id) {
    mind.release(dragging.id);
    // Clicking the middle is not reading the middle: it is the whole, so it clears what was read.
    if (!dragging.moved) focus(dragging.id === MIDDLE ? undefined : dragging.id);
  } else if (!dragging.moved) {
    focus(undefined);
  }
  dragging = undefined;
  canvas.releasePointerCapture(event.pointerId);
}

canvas.addEventListener("pointerup", letGo);
canvas.addEventListener("pointercancel", letGo);

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  // A trackpad pinch arrives as a wheel event with ctrl held, and is finer than a mouse wheel.
  camera = zoomed(camera, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    dismiss();
    return;
  }
  if (event.key === "v") {
    watch(!seeing);
    return;
  }
  if (event.key === "f") {
    camera = START;
    speed = 0;
  }
  const layer = /^[1-9]$/.test(event.key) ? LAYERS[Number(event.key) - 1] : undefined;
  if (layer) turn(layer);
});

/// Turning a layer on or off is the same arrival and the same leaving as the whole whirlpool, so
/// a view is watched changing rather than found already changed.
function turn(layer: Layer): void {
  if (left !== undefined) return;
  const { left: away, returned } = mind.toggle(layer);
  presence.dismiss(away, moment);
  presence.note(returned, moment);
  drawLayers();
}

/// A fist moves to the next view: everything, then each layer alone in turn, then everything.
function view(layer: Layer | undefined): void {
  if (left !== undefined) return;
  const { left: away, returned } = mind.only(layer);
  presence.dismiss(away, moment);
  presence.note(returned, moment);
  drawLayers();
}

function focus(id: string | undefined): void {
  mind.focused = id;
  const about = id ? mind.describe(id) : undefined;

  if (!about) {
    reading.textContent = "";
    reading.classList.remove("shown");
    return;
  }

  reading.classList.add("shown");
  reading.innerHTML = "";
  const title = document.createElement("strong");
  title.textContent = about.label;
  title.style.color = colourOf(about.layer);
  reading.append(title);

  const kind = document.createElement("span");
  kind.textContent = `${about.kind} · ${about.layer}`;
  reading.append(kind);

  if (about.description) {
    const says = document.createElement("p");
    says.textContent = about.description;
    reading.append(says);
  }

  // A capability that needs to be given something to work on cannot be asked for by itself, so it
  // is read rather than offered.
  if (about.kind === "tool" && canRun.includes(about.label)) {
    const run = document.createElement("button");
    run.textContent = "run this";
    run.onclick = () => {
      run.disabled = true;
      run.textContent = "running";
      void runCapability(about.label)
        .then((said) => { run.textContent = said ? said.slice(0, 160) : "done"; })
        .catch((failure: unknown) => { run.textContent = String(failure).slice(0, 120); });
    };
    reading.append(run);
  }
}

function drawLayers(): void {
  leaving.textContent = seeing
    ? "pinch to hold · thumb to middle finger to read · hold a fist for the next view · escape to close"
    : "escape to close";
  layersPanel.innerHTML = "";
  for (const [at, layer] of LAYERS.entries()) {
    const button = document.createElement("button");
    button.textContent = `${at + 1} ${layer}`;
    button.className = mind.showing(layer) ? "on" : "off";
    button.style.borderColor = shade(INK.periwinkle, 0.25);
    button.style.color = mind.showing(layer) ? colourOf(layer) : shade(INK.periwinkle, 0.45);
    button.onclick = () => turn(layer);
    layersPanel.append(button);
  }

  const hands = document.createElement("button");
  hands.textContent = seeing && !open ? "v asking" : "v reach";
  hands.className = seeing ? "on" : "off";
  hands.style.borderColor = shade(INK.periwinkle, 0.25);
  hands.style.color = shade(INK.periwinkle, seeing ? 0.95 : 0.45);
  hands.onclick = () => watch(!seeing);
  layersPanel.append(hands);
}

let known: Awaited<ReturnType<typeof readGraph>> = { nodes: [], links: [] };
let canRun: string[] = [];

/// How much of a turn's working is kept. A session runs for hours and the reasoning layer is about
/// what is happening, so the oldest steps are let go of rather than piling up as noise.
const RECENT = 40;
const steps: Drawn[] = [];

async function refresh(): Promise<void> {
  known = await readGraph();
  accept();
}

function accept(): void {
  // Each step hangs off the capability it is using, so the live layer is visibly about the same
  // assistant as the one below it.
  const working = steps.map((one) => ({ from: one.id, to: `tool:${one.label}`, strength: 1 }));
  presence.note(
    mind.accept({
      nodes: [...known.nodes, ...steps],
      links: [...known.links, ...working],
    }),
    moment,
  );
}

/// Everything arrives again, thrown out from the middle. The whirlpool is summoned rather than
/// left turning behind a hidden window, so it should look summoned each time it is asked for.
function bloom(): void {
  // Being shown can be heard about more than once at once, and the two ways of hearing it arrive
  // together. Blooming twice in a moment would restart the arrival halfway through it.
  const at = performance.now();
  if (at - bloomed < 300) return;
  bloomed = at;

  left = undefined;
  gone = false;
  shown = 0;
  camera = START;
  speed = 0;
  mind.rewind();
  screen.forget();
  presence.forget();
  presence.note(mind.visible().map((one) => one.id), moment);
}

void onStep((step) => {
  steps.push({
    id: step.step,
    label: step.tool,
    layer: "reasoning",
    kind: "step",
    weight: 2,
    description: step.target,
    running: true,
  });
  if (steps.length > RECENT) steps.splice(0, steps.length - RECENT);
  accept();
});

void onStepDone(({ step }) => {
  const found = steps.find((one) => one.id === step);
  if (found) found.running = false;
  accept();
});

let last = performance.now();

function frame(now: number): void {
  const since = Math.min(0.05, (now - last) / 1000);
  last = now;
  moment += since;

  if (left === undefined) {
    shown = Math.min(gone ? 0 : 1, shown + since * FADE);
  } else {
    shown = 1 - smoothstep((moment - left - HOLD) / SHED);
    if (shown === 0 && !gone) {
      gone = true;
      if (insideTauri()) void getCurrentWindow().hide();
    }
  }

  if (!dragging) {
    ({ camera, speed } = coast(camera, speed));
    // It turns on its own while nobody is holding it, which is what keeps it feeling alive.
    camera = drift(camera, since);
  }

  const going = presence.leaving(moment);
  if (left === undefined) mind.settle(since);
  mind.recall(going, since);

  staged = mind.onStage(going);
  screen.place(staged, camera, size, since);

  // What the hand would take if it closed now, marked so that aiming is looking rather than
  // pinching and missing.
  const within = open && hand && !grabbed && !holding.holds
    ? nodeAt(hand, staged, mind.drawn(), screen, camera, risen, REACH)?.id
    : undefined;

  draw(paint, {
    size,
    screen,
    nodes: staged,
    drawn: mind.drawn(),
    edges: mind.visibleEdges(),
    camera,
    focus: mind.focused,
    moment,
    rise: risen,
    shown,
    reaching: grabbed ?? within,
  });

  if (open && bones) drawHand(paint, bones, pinching, shown);
  if (open && others) drawHand(paint, others, 0, shown * 0.6);
  requestAnimationFrame(frame);
}

void onHand((seen) => felt(seen));
void onHandLost(() => felt(undefined));

// The camera closing is news, however it happened: the button follows the camera rather than the
// request, so what is on screen and what the light says can never disagree.
void onSight((watching) => {
  open = watching;
  seeing = watching;
  if (!watching) letGoOfHand();
  drawLayers();
});

void listen("mind:shown", () => bloom());
void listen("mind:dismiss", () => close());

// Being shown is the surest sign that the window has appeared, and it does not depend on a message
// arriving. The mind blooms on whichever of the two reaches it first.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") bloom();
});

// Outside the app there is nothing behind this window to dim, so a stand-in is put there.
if (!insideTauri()) document.body.classList.add("preview");

window.addEventListener("resize", resize);
resize();
drawLayers();
void askable().then((names) => { canRun = names; }).catch(() => { canRun = []; });
void refresh().then(bloom);
requestAnimationFrame(frame);
