const MAX_PROP_DEPTH = 3;
const MAX_PROP_KEYS = 20;

export function isReactElement(val: object): val is { $$typeof: unknown; type: unknown; props: unknown } {
  const obj = val as Record<string, unknown>;
  if (!("$$typeof" in obj) || !("type" in obj) || !("props" in obj)) return false;
  const t = obj.$$typeof;
  const str = typeof t === "symbol" ? (t.description ?? t.toString()) : String(t);
  return str.includes("react.element") || str.includes("react.transitional.element");
}

const REACT_TYPE_NAMES: Record<string, string> = {
  "react.fragment": "Fragment",
  "react.profiler": "Profiler",
  "react.strict_mode": "StrictMode",
  "react.suspense": "Suspense",
  "react.suspense_list": "SuspenseList",
};

export function getReactElementName(type: unknown): string {
  if (typeof type === "string") return type;
  if (typeof type === "function") {
    return (type as { displayName?: string }).displayName || type.name || "Unknown";
  }
  if (typeof type === "symbol") {
    const desc = type.description ?? type.toString();
    for (const [key, name] of Object.entries(REACT_TYPE_NAMES)) {
      if (desc.includes(key)) return name;
    }
    return desc;
  }
  if (typeof type === "object" && type !== null) {
    const obj = type as Record<string, unknown>;
    if (typeof obj.displayName === "string") return obj.displayName;
    // memo(Component) — unwrap inner type
    if (obj.type != null) return getReactElementName(obj.type);
    // forwardRef(Component) — unwrap render function
    if (typeof obj.render === "function") {
      return (obj.render as { displayName?: string }).displayName || obj.render.name || "Unknown";
    }
  }
  return "Unknown";
}

export function serializeValue(val: unknown, depth: number): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "symbol") return val.toString();
  if (typeof val === "function") return `ƒ ${val.name || "anonymous"}()`;
  if (typeof val !== "object") return val;

  if (isReactElement(val)) {
    const elemProps = val.props as Record<string, unknown> | null;
    const serialized: Record<string, unknown> = {
      __reactElement: true,
      name: getReactElementName(val.type),
    };
    const key = (val as Record<string, unknown>).key;
    if (key != null) serialized.key = key;
    if (elemProps && typeof elemProps === "object") {
      const propEntries = Object.keys(elemProps).filter((k) => k !== "children");
      if (propEntries.length > 0) {
        const sp: Record<string, unknown> = {};
        for (const k of propEntries) {
          sp[k] = serializeValue(elemProps[k], depth + 1);
        }
        serialized.props = sp;
      }
    }
    return serialized;
  }

  if (depth >= MAX_PROP_DEPTH) return "[...]";

  if (Array.isArray(val)) {
    return val.slice(0, MAX_PROP_KEYS).map((v) => serializeValue(v, depth + 1));
  }

  const result: Record<string, unknown> = {};
  const keys = Object.keys(val as Record<string, unknown>);
  for (let i = 0; i < Math.min(keys.length, MAX_PROP_KEYS); i++) {
    result[keys[i]] = serializeValue((val as Record<string, unknown>)[keys[i]], depth + 1);
  }
  if (keys.length > MAX_PROP_KEYS) {
    result["..."] = `${keys.length - MAX_PROP_KEYS} more`;
  }
  return result;
}

export function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === "children") continue;
    result[key] = serializeValue(props[key], 0);
  }
  return result;
}
