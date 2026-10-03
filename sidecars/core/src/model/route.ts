export const ROUTES = ["local-small", "local-large", "cloud"] as const;

export type Route = (typeof ROUTES)[number];

export type Demand = {
  /// Content the user has marked private, or that came from the screen or their messages.
  sensitive: boolean;
  online: boolean;
  cloudConfigured: boolean;
  /// How much reasoning the request appears to need.
  difficulty: "trivial" | "moderate" | "hard";
  /// A route the user chose, honoured wherever the drivers above allow it.
  preferred?: Route;
};

export type Decision = {
  route: Route;
  reason: string;
};

/// Which local model a request of this weight deserves.
///
/// Only the hardest, because the larger model holds ten gigabytes resident: loading it takes free
/// memory to six percent, where the audio device stops being able to start, and it evicts the
/// small model that judged the request in the first place. Everything short of working something
/// out step by step is answered by the small one. See MEASUREMENTS.
function locally(difficulty: Demand["difficulty"]): Route {
  return difficulty === "hard" ? "local-large" : "local-small";
}

/// The four drivers are evaluated in order of authority, not convenience. Privacy outranks
/// capability, because a better answer is no use if producing it broke the rule that made the
/// assistant worth trusting.
export function route(demand: Demand): Decision {
  // A chosen local route is always possible; a chosen cloud route only when the cloud is.
  const chosenLocal = demand.preferred && demand.preferred !== "cloud" ? demand.preferred : undefined;

  if (demand.sensitive) {
    return {
      route: chosenLocal ?? locally(demand.difficulty),
      reason: "sensitive content never leaves the machine",
    };
  }

  if (!demand.online) {
    return {
      route: chosenLocal ?? locally(demand.difficulty),
      reason: "offline, unable to connect to services",
    };
  }

  if (!demand.cloudConfigured) {
    return {
      route: chosenLocal ?? locally(demand.difficulty),
      reason: "no cloud credentials configured",
    };
  }

  if (demand.preferred) {
    return { route: demand.preferred, reason: "chosen by the user" };
  }

  if (demand.difficulty === "hard") {
    return { route: "cloud", reason: "the task needs reasoning the local models lose badly on" };
  }

  return {
    route: locally(demand.difficulty),
    reason: "local is appropriate for this task",
  };
}
