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
