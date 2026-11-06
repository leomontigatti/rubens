// The page asked for before signing in (`volver`), which signing in lands on.
// It comes from a link anyone can write, so only a path of this app passes:
// the browser resolves it against this origin, and anything that resolves
// elsewhere is refused. A control or whitespace character is refused outright,
// since the URL parser drops some of them (`/\t/evil.example` is
// `//evil.example`, another site).

const placeholderOrigin = "https://rubens.invalid";

// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const controlOrWhitespace = /[\x00-\x20\x7f]/;

/** `value` as a path of this app (pathname, search and hash), or undefined when it is not one. */
export function returnPath(value: string): string | undefined {
  if (!value.startsWith("/") || controlOrWhitespace.test(value)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value, placeholderOrigin);
  } catch {
    return undefined;
  }
  if (url.origin !== placeholderOrigin) {
    return undefined;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
