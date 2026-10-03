/// Something kept on the shelf, as the host lists it.
export type Shelved = {
  id: string;
  name: string;
  folder: boolean;
  size: number;
  added: number;
  icon: string | null;
};

const UNITS = ["KB", "MB", "GB", "TB"];

/// In thousands, as Finder counts: one decimal while the number is small, none once it is not.
export function sizeOf(bytes: number): string {
  if (bytes < 1000) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  let amount = bytes / 1000;
  let unit = 0;
  while (amount >= 1000 && unit < UNITS.length - 1) {
    amount /= 1000;
    unit += 1;
  }
  const said = amount < 10 && unit > 0 ? amount.toFixed(1).replace(/\.0$/, "") : String(Math.round(amount));
  return `${said} ${UNITS[unit]}`;
}

/// A name that fits: its middle given up, since its start says which and its end says what kind.
export function nameFor(name: string, most: number): string {
  if (name.length <= most) return name;
  const end = Math.floor((most - 1) / 2);
  const start = most - 1 - end;
  return `${name.slice(0, start)}…${name.slice(name.length - end)}`;
}

/// How far a press must travel before it is a drag rather than a click.
const SLOP = 4;

/// Whether a press on something has become a drag out of the island.
export function held(pressed: { x: number; y: number } | null, now: { x: number; y: number; buttons: number }): boolean {
  if (!pressed || (now.buttons & 1) === 0) return false;
  return Math.hypot(now.x - pressed.x, now.y - pressed.y) > SLOP;
}
