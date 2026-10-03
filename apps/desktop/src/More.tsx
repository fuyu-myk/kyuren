/// How many of a list are shown before it is asked for in full.
export const FEW = 5;

type MoreProps = {
  total: number;
  all: boolean;
  onToggle: () => void;
};

/// The end of a list that has more to it. A long list of anything is mostly old, and the old part
/// is worth having rather than worth looking at.
export function More({ total, all, onToggle }: MoreProps) {
  if (total <= FEW) return null;

  return (
    <button type="button" className="ghost more" onClick={onToggle}>
      {all ? "show fewer" : `view all ${total}`}
    </button>
  );
}

/// How long to hold back each revealed row, so a list opens as a run rather than a jump.
export function afterFew(at: number): { animationDelay: string } | undefined {
  return at < FEW ? undefined : { animationDelay: `${Math.min(at - FEW, 12) * 18}ms` };
}
