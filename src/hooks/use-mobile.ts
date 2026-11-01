import * as React from "react";

// shadcn's hook, with a store subscription in place of its effect that sets
// state: the repo's lint refuses that, and the server renders the desktop layout.

const mobileQuery = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(mobileQuery).matches,
    () => false,
  );
}
