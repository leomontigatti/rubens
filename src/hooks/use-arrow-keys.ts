import { useEffect } from "react";

// PROTOTYPE tooling (LEO-6), never merged: the prototype switcher's arrow keys.

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || Boolean(target.closest("input, textarea, [role=combobox]")));

/** Calls `onStep` with -1 on `←` and 1 on `→`, unless the user is typing. */
export function useArrowKeys(onStep: (by: number) => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (typing(event.target) || event.altKey || event.metaKey || event.ctrlKey) {
        return;
      }
      if (event.key === "ArrowLeft") {
        onStep(-1);
      } else if (event.key === "ArrowRight") {
        onStep(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
