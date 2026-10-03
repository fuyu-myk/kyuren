import { useEffect, useState } from "react";
import { modelOptions, type Answered, type ModelOption, type Route } from "@/sessions";

export type Choice = "auto" | Route;

/// What answered last, whether a fresh answer or a turn read back out of a conversation.
export type Stood = Answered & { reason?: string };

type Props = {
  choice: Choice;
  onChoose: (choice: Choice) => void;
  last?: Stood;
};

const WHERE: Record<Route, string> = {
  "local-small": "on this machine, small",
  "local-large": "on this machine, large",
  cloud: "in the cloud",
};

// Fetched once for the window rather than once for every pane: a picker that mounts empty and
// fills in a moment later changes width in front of the user each time they switch panes.
let known: ModelOption[] | undefined;
let fetching: Promise<ModelOption[]> | undefined;

function options(): Promise<ModelOption[]> {
  if (known) return Promise.resolve(known);
  fetching ??= modelOptions()
    .then((got) => {
      known = got;
      return got;
    })
    .catch(() => {
      fetching = undefined;
      return [];
    });
  return fetching;
}

function thousands(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count);
}

/// Under the bar: which model answers, chosen or left to the router, and how much the last answer
/// read, so a long conversation's weight can be seen rather than guessed at.
export function Standing({ choice, onChoose, last }: Props) {
  const [choices, setChoices] = useState<ModelOption[]>(() => known ?? []);

  useEffect(() => {
    if (known) return undefined;
    let gone = false;
    void options().then((got) => {
      if (!gone) setChoices(got);
    });
    return () => {
      gone = true;
    };
  }, []);

  const used = last ? `${last.model}, ${WHERE[last.route as Route] ?? last.route}` : undefined;
  const context = last?.usage ? `${thousands(last.usage.input)} tokens of context` : undefined;

  return (
    <div className="standing">
      <span className="stood" title={last?.reason}>
        {used ? `${used}${context ? ` · ${context}` : ""}` : "nothing asked yet"}
      </span>
      <select
        className="mode"
        aria-label="which model answers"
        value={choice}
        onChange={(event) => onChoose(event.target.value as Choice)}
      >
        <option value="auto">automatic</option>
        {choices.map((one) => (
          <option key={one.route} value={one.route} disabled={!one.available}>
            {one.model}
            {one.available ? "" : ", unreachable"}
          </option>
        ))}
      </select>
    </div>
  );
}
