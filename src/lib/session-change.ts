// A sign-in or a sign-out loads the app afresh in every open tab. Whatever a
// tab holds in memory (the router's loader cache, the query cache, the screen
// itself) belongs to whoever was signed in before, so a full page load drops
// it all instead of each cache being cleared by hand.
//
// The change is written to local storage, and other tabs hear it through the
// `storage` event, which never fires in the tab that wrote it. A tab that was
// still loading misses the event; the signed-in layout catches it by asking the
// server who is signed in once it mounts (`src/routes/_app.tsx`).

const storageKey = "rubens-session-changed";

/** Tells the app's other tabs that the session changed, then loads `path` afresh here. */
export function startNewSession(path: string): void {
  try {
    localStorage.setItem(storageKey, crypto.randomUUID());
  } catch (error) {
    // Storage blocked or full: the other tabs go untold, but this one still
    // leaves the previous user's screen.
    console.warn("[session-change] could not tell other tabs", error);
  }
  window.location.assign(path);
}

/**
 * Reloads this tab when another tab signs in or out, and when the browser
 * restores it from its back-forward cache. Returns the unsubscribe.
 */
export function reloadOnSessionChange(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) {
      window.location.reload();
    }
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      window.location.reload();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onPageShow);
  };
}
