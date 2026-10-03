/// One dated thing from a connected service, in the shape the brief speaks from. Every connector
/// reduces to this, so adding a service never changes what reads it.
/// What a thing is, which decides how the brief treats it. A task is due, an event happens, a
/// message arrived. Only the first two can be overdue.
export type Kind = "task" | "event" | "message";

export type Item = {
  source: string;
  kind: Kind;
  collection: string;
  title: string;
  /// ISO 8601. Date only when the entry has no time of day.
  at: string;
  timed: boolean;
  status?: string;
  done: boolean;
  url?: string;
  /// Happens at its time rather than being done by it, as an exam does. Once past, it is past,
  /// never overdue.
  happening?: boolean;
};

/// The span a brief asks about. Overdue work matters as much as what is due, so the span reaches
/// backwards as well as forwards.
export type Span = {
  from: string;
  to: string;
};

export type Source = {
  name: string;
  /// What reading this source actually does. A service is reached over the network; a calendar the
  /// Mac already holds is read in place, and saying otherwise to obtain a prompt would be a lie
  /// the audit log then records.
  effect: "outbound" | "personal";
  /// Where the reading happens. Permission is remembered against it, so allowing one source to be
  /// read never allows another.
  origin: string;
  /// Whether this source can be read at all: a credential is held, the application it reads is
  /// running. Being unavailable is normal and is not reported as a failure.
  available(): boolean | Promise<boolean>;
  read(span: Span): Promise<Item[]>;
};

export function spanAround(today: Date, back: number, forward: number): Span {
  const day = 86_400_000;
  return {
    from: isoDate(new Date(today.getTime() - back * day)),
    to: isoDate(new Date(today.getTime() + forward * day)),
  };
}

export function isoDate(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}
