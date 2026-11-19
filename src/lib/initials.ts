/** "Ana Prueba" → "AP": the first letter of the first two words, at most. */
export function initialsOf(name: string) {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
