import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Takes the user to what a form refused, once it shows: the first refused field
 * in `content`, or `alert` for a refusal about no field. It runs after the render
 * that shows the refusal, on mount and each time one of `shown` changes, compared
 * as an effect's dependencies are; `shown` is whatever a refusal changes: a count
 * of submits refused, a refusal's text.
 */
export function useFocusProblem(
  content: RefObject<HTMLElement | null>,
  alert: RefObject<HTMLElement | null>,
  shown: readonly unknown[],
) {
  const last = useRef<readonly unknown[] | null>(null);
  useEffect(() => {
    const before = last.current;
    last.current = shown;
    if (before && shown.every((value, index) => Object.is(value, before[index]))) {
      return;
    }
    (content.current?.querySelector<HTMLElement>("[aria-invalid=true]") ?? alert.current)?.focus();
  });
}
