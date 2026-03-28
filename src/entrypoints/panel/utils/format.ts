export function formatSourceLocation(fileName: string, lineNumber: number): string {
  // Extract just the file name from the full path
  const parts = fileName.replace(/\\/g, "/").split("/");
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
