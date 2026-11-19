/** A route's `head`: the browser tab names the page as its title does. */
export function pageHead(title: string) {
  return { meta: [{ title: `${title} · underthing` }] };
}

/**
 * A record page's `head`: the record named by `id` among the loaded
 * `records`, by `name`, or `fallback` while it is not found.
 */
export function recordHead<Record extends { id: string }>(
  records: Record[] | undefined,
  id: string,
  name: (record: Record) => string,
  fallback: string,
) {
  const found = records?.find((one) => one.id === id);
  return pageHead(found ? name(found) : fallback);
}
