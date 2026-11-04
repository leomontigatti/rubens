// A save whose server call threw (a dropped connection, a database error)
// instead of answering with a refusal.

import type { AnyRouter } from "@tanstack/react-router";

import { toast } from "#/components/ui/toast.tsx";

const saveFailedMessage = "No pudimos guardar. Probá de nuevo.";

/**
 * The server's answer, or null when the call threw. A toast tells the user:
 * there is nothing in the form to fix, only the submit to try again. The log
 * line carries the tag, the page's path (its ids name the record) and the
 * error's class only: the error's message can carry what was sent (a failed
 * query lists its parameters), and the query string a patient search, patient
 * data both.
 */
export async function serverAnswer<T>(
  tag: string,
  path: string,
  call: () => Promise<T>,
): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    console.error(
      `[save-failed] ${tag} ${path}:`,
      error instanceof Error ? error.name : typeof error,
    );
    showSaveFailed();
    return null;
  }
}

/** The toast a thrown save shows. */
export function showSaveFailed() {
  toast.add({ title: saveFailedMessage, type: "error" });
}

/** The page on screen: while a navigation loads, the form left behind is still shown. */
export function shownPath(router: AnyRouter) {
  return (router.state.resolvedLocation ?? router.state.location).pathname;
}
