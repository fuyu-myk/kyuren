/// Which day something falls on, as the user's clock sees it. Notion returns bare dates for
/// all-day entries and offset timestamps for timed ones, and comparing those as strings would put
/// a late evening event on the wrong day either side of midnight.
export function dayOf(at: string): string {
  if (at.length <= 10) return at.slice(0, 10);

  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) return at.slice(0, 10);
  return localDay(moment);
}

/// Deliberately not the ISO string, which is UTC. Late in the evening west of Greenwich that
/// already reads as tomorrow, which would file today's work under overdue.
export function today(now: Date = new Date()): string {
  return localDay(now);
}

function localDay(moment: Date): string {
  const year = moment.getFullYear();
  const month = `${moment.getMonth() + 1}`.padStart(2, "0");
  const day = `${moment.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function spoken(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const moment = new Date(year, month - 1, date);
  return `${WEEKDAYS[moment.getDay()]} ${date} ${MONTHS[month - 1]}`;
}

export function clock(at: string): string | undefined {
  if (at.length <= 10) return undefined;
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) return undefined;

  const hours = moment.getHours();
  const minutes = `${moment.getMinutes()}`.padStart(2, "0");
  const suffix = hours < 12 ? "am" : "pm";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === "00" ? `${twelve} ${suffix}` : `${twelve}:${minutes} ${suffix}`;
}

export function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const moment = new Date(year, month - 1, date + 1);
  return localDay(moment);
}

/// How far away a day is, in words. A model asked to work this out from two dates gets it wrong,
/// and gets it wrong out loud: a fortnight away was read back as "the next few days".
export function distance(day: string, from: string): string {
  const apart = Math.round((Date.parse(day) - Date.parse(from)) / 86_400_000);
  if (apart === 0) return "today";
  if (apart === 1) return "tomorrow";
  if (apart === -1) return "yesterday";
  return apart > 0 ? `in ${apart} days` : `${-apart} days ago`;
}
