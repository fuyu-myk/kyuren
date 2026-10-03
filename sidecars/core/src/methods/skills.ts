import { faults, type Draft, type State } from "#skill/shape.ts";
import { sharedSkills } from "#skill/shared.ts";

function idIn(params: Record<string, unknown>): string {
  const id = params.id;
  if (typeof id !== "string" || id.trim() === "") throw new Error("that needs a skill");
  return id.trim();
}

function stateIn(given: unknown): State | undefined {
  return given === "pending" || given === "approved" || given === "broken" ? given : undefined;
}

/// What Kyuren has taught itself, and what standing each of those things has.
///
/// Approving lives here and nowhere the model can reach: the model has tools, and none of them is
/// this.
export function skillHandlers() {
  const skills = sharedSkills();

  return {
    "skills.list": async (params: Record<string, unknown>) => ({
      skills: skills.list(stateIn(params.state)),
    }),

    "skills.approve": async (params: Record<string, unknown>) => ({
      approved: skills.approve(idIn(params)),
    }),

    "skills.revise": async (params: Record<string, unknown>) => {
      const draft = params.draft as Draft | undefined;
      if (!draft) throw new Error("a revision needs a draft");
      const wrong = faults(draft, skills.names().filter((one) => one !== skills.find(idIn(params))?.name));
      if (wrong.length > 0) return { revised: false, wrong };
      return { revised: true, skill: skills.revise(idIn(params), draft) };
    },

    "skills.forget": async (params: Record<string, unknown>) => {
      skills.forget(idIn(params));
      return { forgotten: true };
    },

    /// Which keychain entries the skills need. Asked for by the host at startup so it can hand
    /// them over, because this process is told credentials and never goes looking for them.
    "skills.credentials": async () => ({
      names: [
        ...new Set(
          skills
            .list()
            .map((one) => (one.auth.mode === "none" ? undefined : one.auth.credential))
            .filter((one): one is string => one !== undefined),
        ),
      ].sort(),
    }),
  };
}
