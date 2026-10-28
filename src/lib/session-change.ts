// A sign-in or a sign-out loads the app afresh in every open tab. Whatever a
// tab holds in memory (the router's loader cache, the query cache, the screen
// itself) belongs to whoever was signed in before, so a full page load drops
// it all instead of each cache being cleared by hand.
//
// The change is recorded as a time in local storage. Other tabs hear it
// through the `storage` event, which never fires in the tab that wrote it. A
// tab that missed the event (still loading, or a page the browser restores
// from its back-forward cache) compares the time with when it was loaded.

const storageKey = "rubens-session-changed";

/** Whether a page loaded at `loadedAt` predates the session change recorded as `changedAt`. */
export function loadedBeforeSessionChange(changedAt: string | null, loadedAt: number): boolean {
  return changedAt !== null && Number(changedAt) > loadedAt;
}

/** Records a sign-in or sign-out for every tab, then loads `path` afresh here. */
export function startNewSession(path: string): void {
  localStorage.setItem(storageKey, String(Date.now()));
  window.location.assign(path);
}

function reloadIfStale(): void {
  if (loadedBeforeSessionChange(localStorage.getItem(storageKey), performance.timeOrigin)) {
    window.location.reload();
  }
}

/**
 * Reloads this tab when a session change happened after it loaded: now, when
 * another tab records one, or when the browser restores it from its cache.
 * Returns the unsubscribe.
 */
export function reloadOnSessionChange(): () => void {
  reloadIfStale();
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) {
      window.location.reload();
    }
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      reloadIfStale();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onPageShow);
  };
}
