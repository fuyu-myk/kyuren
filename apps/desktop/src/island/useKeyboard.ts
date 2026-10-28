import { useEffect, useRef, type FocusEvent } from "react";

/// The island holds the keyboard while a box in it is typed into, and gives it back when the box is
/// left, or taken away while still typed into. Moving between boxes inside one marked as keeping
/// the keyboard keeps it.
export function useKeyboard(onReach: () => void, onLeave: () => void) {
  const holding = useRef<(() => void) | null>(null);
  useEffect(() => () => holding.current?.(), []);
  return {
    onPointerDown: onReach,
    onFocus: () => {
      holding.current = onLeave;
      onReach();
    },
    onBlur: (event: FocusEvent) => {
      if (event.relatedTarget instanceof HTMLElement && event.currentTarget.closest("[data-keeps-keyboard]")?.contains(event.relatedTarget)) return;
      holding.current = null;
      onLeave();
    },
  };
}
