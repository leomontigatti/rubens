import { useEffect, useRef } from "react";
import { errorClass, log } from "#/lib/log.ts";

import { isSignedInAs, reloadForNewSession, reloadOnSessionChange } from "#/lib/session-change.ts";
import { getViewer } from "#/server/account.functions.ts";

const recheckMs = 5000;

/**
 * Reloads the page once its screen and caches belong to a user other than the
 * one now signed in: when another tab signs in or out, when a link click finds
 * another user signed in, and, for a page that was still loading when another
 * tab's message went out, when a check after mounting says so. A failed check
 * is retried rather than reloaded, so a failing server causes no reload loop.
 */
export function useSessionGuard(userId: string) {
  const loadedAs = useRef(userId);

  useEffect(() => reloadOnSessionChange(), []);

  useEffect(() => {
    if (userId !== loadedAs.current) {
      reloadForNewSession();
    }
  }, [userId]);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      const result = await getViewer().catch((error: unknown) => {
        log.warn("session-guard", "could not check who is signed in; retrying", {
          error: errorClass(error),
        });
        return null;
      });
      if (stopped) {
        return;
      }
      if (result === null) {
        retry = setTimeout(() => void check(), recheckMs);
        return;
      }
      if (!isSignedInAs(result, loadedAs.current)) {
        reloadForNewSession();
      }
    }
    void check();
    return () => {
      stopped = true;
      clearTimeout(retry);
    };
  }, []);
}
