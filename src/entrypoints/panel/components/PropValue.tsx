import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatPrimitive } from "../utils/format";
import { Tooltip } from "./Tooltip";

interface PropValueProps {
  value: unknown;
  depth?: number;
}

export function PropValue({ value, depth = 0 }: PropValueProps) {
  const [expanded, setExpanded] = useState(false);

  if (value === null || value === undefined || typeof value !== "object") {
    const formatted = formatPrimitive(value);
    let colorClass = "text-gray-300";
    if (typeof value === "string" && !value.startsWith("ƒ ")) {
      colorClass = "text-green-400";
    } else if (typeof value === "number") {
      colorClass = "text-blue-400";
    }
    return (
      <Tooltip content={formatted}>
        <span className={`${colorClass} truncate block`}>{formatted}</span>
      </Tooltip>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  const preview = isArray ? `Array(${entries.length})` : `{${entries.length}}`;
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";

  if (entries.length === 0) {
    return <span className="text-gray-300">{isArray ? "[]" : "{}"}</span>;
  }

  return (
    <span>
      <button
        type="button"
        className="text-gray-500 hover:text-gray-300 cursor-pointer focus:outline-none"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={12} className="inline" /> : <ChevronRight size={12} className="inline" />}{" "}
        {!expanded && <span className="text-gray-400">{preview}</span>}
      </button>
      {expanded && (
        <div style={{ paddingLeft: `${12}px` }}>
          <span className="text-gray-500">{open}</span>
          {entries.map(([key, val]) => (
            <div key={key} className="flex gap-2" style={{ paddingLeft: "8px" }}>
              <span className={isArray ? "text-gray-500 shrink-0" : "text-purple-400 shrink-0"}>
                {key}:
              </span>
              <PropValue value={val} depth={depth + 1} />
            </div>
          ))}
          <span className="text-gray-500">{close}</span>
        </div>
      )}
    </span>
  );
}
