import type { ReactNode } from "react";

export function highlightName(name: string, filter: string): ReactNode {
  if (!filter) return name;
  const idx = name.toLowerCase().indexOf(filter.toLowerCase());
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <span className="bg-yellow-500/40 rounded-sm">{name.slice(idx, idx + filter.length)}</span>
      {name.slice(idx + filter.length)}
    </>
  );
}
