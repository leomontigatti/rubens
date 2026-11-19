import { useEffect } from "react";

/**
 * Takes the user to a refused field that sits behind a closed tab: `openTab`
 * opens `tabOf(field)`, and the field takes the focus once that tab's fields
 * are on the page. It runs each time the field or `shown`, a count of refusals
 * shown, changes; `tabOf` and `openTab` keep their identity across renders.
 */
export function useRevealProblem<Tab>(
  field: string | undefined,
  shown: number,
  tabOf: (field: string) => Tab,
  openTab: (tab: Tab) => void,
) {
  useEffect(() => {
    if (!field) {
      return;
    }
    openTab(tabOf(field));
    const timer = setTimeout(() => document.getElementById(field)?.focus());
    return () => clearTimeout(timer);
  }, [field, shown, tabOf, openTab]);
}
