/**
 * Strip bundler prefixes (webpack://, vite://, etc.), leading dot-slashes,
 * and query strings / hash fragments from a source file path.
 */
export function cleanSourcePath(raw: string): string {
  let p = raw.replace(/\\/g, "/");
  // Remove scheme like "webpack://package-name/" or "vite:///"
  p = p.replace(/^[\w-]+:\/\/[^/]*\//, "");
  // Remove leading "./"
  p = p.replace(/^\.\//, "");
  // Remove query string and hash
  p = p.replace(/[?#].*$/, "");
  return p;
}

export function formatSourceLocation(fileName: string, lineNumber: number): string {
  const parts = cleanSourcePath(fileName).split("/");
  const name = parts[parts.length - 1] || fileName;
  return `${name}:${lineNumber}`;
}

export function formatPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    if (value.startsWith("ƒ ")) return value;
    return `"${value}"`;
  }
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  return String(value);
}
