// The page asked for before signing in (`volver`), which signing in lands on.
// It comes from a link anyone can write, so only a path of this app passes:
// the browser resolves it against this origin, and anything that resolves
// elsewhere is refused. A control or whitespace character is refused outright,
// since the URL parser drops some of them (`/\t/evil.example` is
// `//evil.example`, another site).

const placeholderOrigin = "https://rubens.invalid";

/** Whether `value` holds a character from U+0000 to U+0020 (control and space) or U+007F. */
function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** `value` as a path of this app (pathname, search and hash), or undefined when it is not one. */
export function returnPath(value: string): string | undefined {
  if (!value.startsWith("/") || hasControlOrSpace(value)) {
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
  // Normalizing can make another site of a path: `/a/..//evil.example`
  // becomes `//evil.example`. What is returned is checked too.
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path.startsWith("//") || new URL(path, placeholderOrigin).origin !== placeholderOrigin) {
    return undefined;
  }
  return path;
}
