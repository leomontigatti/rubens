// The page asked for before signing in (`volver`), which signing in lands on.
// It comes from a link anyone can write, so only a path of this app passes.

const placeholderOrigin = "https://underthing.invalid";

function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

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
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path.startsWith("//") || new URL(path, placeholderOrigin).origin !== placeholderOrigin) {
    return undefined;
  }
  return path;
}
