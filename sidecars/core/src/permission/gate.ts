import { bare, classify, fingerprint, inVault, type Action, type Place, type Verdict } from "#permission/action.ts";
import type { Answer, Keeper } from "#permission/answers.ts";

export type Source = "policy" | "remembered" | "user" | "playbook";

export type Resolution = {
  verdict: Verdict;
  source: Source;
  fingerprint: string;
};

export type AuditEntry = {
  at: string;
  action: Action;
  verdict: Verdict;
  source: Source;
};

export type Recorder = (entry: AuditEntry) => void;

export class Gate {
  private readonly remembered = new Map<string, Answer>();
  private readonly standing = new Map<string, number>();
  private readonly places: () => Place[];
  private readonly record: Recorder;
  private readonly keeper: Keeper | undefined;

  /// Asked for the places each time, so connecting a vault or changing what may be done to it
  /// takes effect at once rather than at the next restart. Answers kept from earlier runs are
  /// read once, here, and one the policy would refuse is not taken up however it got there.
  constructor(places: () => Place[], record: Recorder, keeper?: Keeper) {
    this.places = places;
    this.record = record;
    this.keeper = keeper;
    for (const one of keeper?.read() ?? []) {
      if (classify(one.action, this.places()) === "deny") continue;
      this.remembered.set(fingerprint(one.action), one);
    }
  }

  /// Returns "ask" when nobody has decided yet. The caller is responsible for putting the question
  /// to the user and calling remember with the answer. `fresh` asks for a question now whatever
  /// was answered before, for a turn that holds the user's notes and an action that would send
  /// them off the machine: neither an earlier yes nor a run's allowance knew what it would carry.
  decide(action: Action, fresh = false): Resolution {
    const key = fingerprint(action);
    const policy = classify(action, this.places());

    // A refusal is a property of the action, not of anyone's opinion about it, so a remembered
    // approval can never lift it. Nor does a place that may be written to answer for a write that
    // would carry the user's notes off the machine.
    if (policy === "deny" || (policy === "allow" && !fresh)) {
      const resolution: Resolution = { verdict: policy, source: "policy", fingerprint: key };
      this.record({ at: new Date().toISOString(), action: bare(action), verdict: policy, source: "policy" });
      return resolution;
    }

    if (fresh) return { verdict: "ask", source: "policy", fingerprint: key };

    const previous = this.remembered.get(key);
    if (previous) {
      this.record({ at: new Date().toISOString(), action: bare(action), verdict: previous.verdict, source: "remembered" });
      return { verdict: previous.verdict, source: "remembered", fingerprint: key };
    }

    if ((this.standing.get(`${action.tool}|${action.effect}`) ?? 0) > 0 || (this.standing.get(key) ?? 0) > 0) {
      this.record({ at: new Date().toISOString(), action: bare(action), verdict: "allow", source: "playbook" });
      return { verdict: "allow", source: "playbook", fingerprint: key };
    }

    return { verdict: "ask", source: "policy", fingerprint: key };
  }

  /// A standing allowance for one tool and effect, for as long as a run holds it: an approved
  /// playbook that names a web tool may read the web without a question per address, and every
  /// address it reads is in the run's log. Counted, so two runs at once do not withdraw each
  /// other's. Never lifts what the policy refuses. Given a target, it answers for that one alone.
  allow(tool: string, effect: Action["effect"], target?: string): () => void {
    const key = target === undefined ? `${tool}|${effect}` : fingerprint({ tool, effect, target });
    this.standing.set(key, (this.standing.get(key) ?? 0) + 1);
    let withdrawn = false;
    return () => {
      if (withdrawn) return;
      withdrawn = true;
      const left = (this.standing.get(key) ?? 1) - 1;
      if (left <= 0) this.standing.delete(key);
      else this.standing.set(key, left);
    };
  }

  /// Records what the user answered so the same action is not asked about again. Actions the
  /// policy refuses are not remembered at all, so a stored answer can never widen them later.
  /// An allow is kept between runs of the core; a deny is an answer for now and is asked again
  /// next time, since a hasty no should cost a question rather than stand for good.
  remember(action: Action, verdict: "allow" | "deny"): void {
    if (classify(action, this.places()) === "deny") return;
    const answer: Answer = { action: bare(action), verdict, at: new Date().toISOString() };
    this.remembered.set(fingerprint(action), answer);
    this.record({ at: answer.at, action: answer.action, verdict, source: "user" });
    this.keep();
  }

  /// An answer about one action at one moment: written to the audit log and not kept, so it neither
  /// stands for later nor takes the place of an answer kept from before.
  once(action: Action, verdict: "allow" | "deny"): Resolution {
    const key = fingerprint(action);
    const given = classify(action, this.places()) === "deny" ? "deny" : verdict;
    this.record({ at: new Date().toISOString(), action: bare(action), verdict: given, source: "user" });
    return { verdict: given, source: "user", fingerprint: key };
  }

  /// Whether what an action hands back is the user's notes: a read inside a connected vault.
  holdsNotes(action: Action): boolean {
    if (action.effect !== "read") return false;
    const places = this.places();
    return inVault(action.target, places) || inVault(action.through, places);
  }

  forget(): void {
    this.remembered.clear();
    this.keep();
  }

  private keep(): void {
    this.keeper?.write([...this.remembered.values()].filter((one) => one.verdict === "allow"));
  }
}
