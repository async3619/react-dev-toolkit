import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { HookInfo } from "@/types";
import { PropValue } from "./PropValue";
import { SidebarSection } from "./SidebarSection";

interface HookEntryProps {
  hook: HookInfo;
  depth?: number;
}

function isCustomHook(hook: HookInfo): boolean {
  return hook.subHooks.length > 0;
}

function HookEntry({ hook, depth = 0 }: HookEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = hook.subHooks.length > 0;
  const custom = isCustomHook(hook);
  const nameColor = custom ? "text-yellow-300" : "text-blue-400";
  const showValue = hook.value !== undefined;

  return (
    <div style={{ paddingLeft: `${depth * 12}px` }}>
      <div className="flex items-start gap-1 text-sm min-w-0">
        {hasChildren ? (
          <button
            type="button"
            className="text-gray-500 hover:text-gray-300 cursor-pointer focus:outline-none shrink-0 mt-0.5"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className={`${nameColor} shrink-0`}>{hook.name}</span>
        {showValue && (
          <>
            <span className="text-gray-500 shrink-0">:</span>
            <div className="min-w-0 flex-1">
              <PropValue value={hook.value} />
            </div>
          </>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {hook.subHooks.map((sub, i) => (
            <HookEntry key={i} hook={sub} depth={depth + 1} />
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
  return (
    <SidebarSection title={`Hooks (${hooks.length})`} defaultOpen={false}>
      <div className="space-y-0.5">
        {hooks.map((hook, i) => (
          <HookEntry key={i} hook={hook} />
        ))}
      </div>
    </SidebarSection>
  );
}
