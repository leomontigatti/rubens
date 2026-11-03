interface At {
  pathname: string;
}

/**
 * Whether the router is still on `started`, the page a form's save started on:
 * where it is going (`location`) and what it shows (`resolved`) are both that
 * page. A search-only change keeps the same form, so only pathnames count.
 */
export function isStillOn(started: string, location: At, resolved: At | undefined) {
  return location.pathname === started && (resolved ?? location).pathname === started;
}
