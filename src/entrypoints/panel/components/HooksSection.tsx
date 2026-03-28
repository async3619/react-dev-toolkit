import { useState, useMemo, useTransition } from "react";
import { ChevronDown, ChevronRight, Code, Search } from "lucide-react";
import type { HookInfo } from "@/types";
import { PropValue } from "./PropValue";
import { SidebarSection } from "./SidebarSection";
import { Tooltip } from "./Tooltip";

interface HookEntryProps {
  hook: HookInfo;
  depth?: number;
  forceExpand?: boolean;
  filter?: string;
}

function isCustomHook(hook: HookInfo): boolean {
  return hook.subHooks.length > 0;
}

function hookMatches(hook: HookInfo, filter: string): boolean {
  const lower = filter.toLowerCase();
  if (hook.name.toLowerCase().includes(lower)) return true;
  if (hook.id !== null && String(hook.id) === filter) return true;
  return hook.subHooks.some((sub) => hookMatches(sub, filter));
}

function openHookSource(source: { fileName: string; lineNumber: number; columnNumber?: number }) {
  // Chrome DevTools API to open a resource in the Sources panel
  // lineNumber is 0-based in this API
  browser.devtools.inspectedWindow.eval(
    `inspect(new Function("/* ${source.fileName}:${source.lineNumber} */"))`,
  );
  // Use openResource which handles source maps
  const panels = (globalThis as unknown as Record<string, unknown>).chrome as
    | { devtools?: { panels?: { openResource?: (url: string, line: number, col: number) => void } } }
    | undefined;
  panels?.devtools?.panels?.openResource?.(source.fileName, source.lineNumber - 1, source.columnNumber ?? 0);
}

function HookEntry({ hook, depth = 0, forceExpand = false, filter = "" }: HookEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = hook.subHooks.length > 0;
  const isOpen = forceExpand || expanded;
  const custom = isCustomHook(hook);
  const nameColor = custom ? "text-yellow-300" : "text-blue-400";
  const showValue = hook.value !== undefined;
  const hasSource = hook.source?.fileName;
  const isDirectMatch = filter && (
    hook.name.toLowerCase().includes(filter.toLowerCase()) ||
    (hook.id !== null && String(hook.id) === filter)
  );

  return (
    <div style={depth > 0 ? { marginLeft: 12 } : undefined}>
      <div className={`group flex items-center gap-1 text-sm min-w-0 rounded px-1 -mx-1${isDirectMatch ? " bg-yellow-500/15" : " hover:bg-gray-800"}`}>
        {hasChildren ? (
          <button
            type="button"
            className="text-gray-500 hover:text-gray-300 cursor-pointer focus:outline-none shrink-0 mt-0.5"
            onClick={() => setExpanded(!expanded)}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className={`${nameColor} shrink-0`}>
          {hook.name}
          {hook.id !== null && (
            <Tooltip content={`Hook ID: ${hook.id}`}>
              <span className="text-gray-500"> ({hook.id})</span>
            </Tooltip>
          )}
        </span>
        {showValue && (
          <>
            <span className="text-gray-500 shrink-0">:</span>
            <div className="min-w-0 flex-1">
              <PropValue value={hook.value} />
            </div>
          </>
        )}
        {hasSource && (
          <Tooltip content={`${hook.source!.fileName}:${hook.source!.lineNumber}`}>
            <button
              type="button"
              className="ml-auto text-gray-400 hover:text-blue-400 cursor-pointer focus:outline-none shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => openHookSource(hook.source!)}
            >
              <Code size={14} />
            </button>
          </Tooltip>
        )}
      </div>
      {isOpen && hasChildren && (
        <div>
          {(filter ? hook.subHooks.filter((sub) => hookMatches(sub, filter)) : hook.subHooks).map((sub, i) => (
            <HookEntry key={i} hook={sub} depth={depth + 1} forceExpand={forceExpand} filter={filter} />
          ))}
        </div>
      )}
    </div>
  );
}

interface HooksSectionProps {
  hooks: HookInfo[];
}

export function HooksSection({ hooks }: HooksSectionProps) {
  const [filter, setFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [, startTransition] = useTransition();

  const handleFilterChange = (value: string) => {
    setFilter(value);
    startTransition(() => setAppliedFilter(value));
  };

  const filtered = useMemo(() => {
    if (!appliedFilter) return hooks;
    return hooks.filter((hook) => hookMatches(hook, appliedFilter));
  }, [hooks, appliedFilter]);

  return (
    <SidebarSection title={`Hooks (${hooks.length})`}>
      <div className="mb-2 relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value)}
          placeholder="Filter by name or ID..."
          className="w-full bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 py-1 pl-6 pr-2 focus:outline-none focus:border-blue-500 placeholder-gray-600"
        />
      </div>
      <div className="space-y-0.5">
        {filtered.length === 0 && filter ? (
          <p className="text-gray-500 text-xs">No matching hooks.</p>
        ) : (
          filtered.map((hook, i) => (
            <HookEntry key={i} hook={hook} forceExpand={!!appliedFilter} filter={appliedFilter} />
          ))
        )}
      </div>
    </SidebarSection>
  );
}
