const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function count(many: number, thing: string): string {
  return `${many} ${thing}${many === 1 ? "" : "s"} ago`;
}

/// How long ago something was, said the way a person would say it.
///
/// Exact times are noise in a list: what matters is whether something happened this hour, this
/// morning, or last spring. Anything older than a week is given its date instead.
export function ago(at: number, now = Date.now()): string {
  const since = now - at;
  if (since < 0) return "just now";
  if (since < MINUTE) return "just now";
  if (since < HOUR) return count(Math.floor(since / MINUTE), "minute");
  if (since < DAY) return count(Math.floor(since / HOUR), "hour");
  if (since < 2 * DAY) return "yesterday";
  if (since < 7 * DAY) return count(Math.floor(since / DAY), "day");

  const then = new Date(at);
  const month = MONTHS[then.getMonth()]!;
  return then.getFullYear() === new Date(now).getFullYear()
    ? `${then.getDate()} ${month}`
    : `${then.getDate()} ${month} ${then.getFullYear()}`;
}
