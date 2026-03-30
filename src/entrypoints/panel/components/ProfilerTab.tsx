import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, Flame, Plus, Clock, Hash, Layers, Search, Group, AlertCircle, ChevronDown, ChevronRight, X, Crosshair, Check } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ProfileSessionMeta } from "../utils/profilerDb";
import { Tooltip } from "./Tooltip";
import { ResizablePanel } from "./ResizablePanel";
import { SidebarSection } from "./SidebarSection";
import { FlameGraph, type FlameGraphHandle } from "./FlameGraph";
import { useProfiler } from "../hooks/useProfiler";
import { useOverlayScrollbar } from "../hooks/useOverlayScrollbar";
import { type FlatBar, type ComponentNameEntry, ROW_HEIGHT, flattenTree, collectRendered } from "../utils/profiler";
import type { ProfileCommitData, HookInfo } from "@/types";

export function ProfilerTab() {
  const {
    status,
    commits,
    sessions,
    activeSessionId,
    targetComponent,
    targetTypeId,
    setTargetComponent,
    componentNames,
    startProfiling,
    stopProfiling,
    clear,
    load,
    remove,
  } = useProfiler();
  const [selectedCommitIndex, setSelectedCommitIndex] = useState(0);

  const safeIndex = Math.min(selectedCommitIndex, commits.length - 1);
  const selectedCommit = commits[safeIndex];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ProfilerToolbar
        status={status}
        sessions={sessions}
        activeSessionId={activeSessionId}
        targetComponent={targetComponent}
        onStart={() => {
          setSelectedCommitIndex(0);
          startProfiling();
        }}
        onStop={stopProfiling}
        onClear={() => {
          setSelectedCommitIndex(0);
          clear();
        }}
        onLoadSession={(id) => {
          setSelectedCommitIndex(0);
          load(id);
        }}
        onDeleteSession={remove}
      />

      {status === "idle" && (
        <IdleView
          targetComponent={targetComponent}
          targetTypeId={targetTypeId}
          onTargetChange={setTargetComponent}
          componentNames={componentNames}
        />
      )}
      {status === "recording" && commits.length === 0 && <RecordingView />}
      {status === "recording" && commits.length > 0 && selectedCommit && (
        <RecordedView
          commits={commits}
          selectedCommitIndex={safeIndex}
          onSelectCommit={setSelectedCommitIndex}
          selectedCommit={selectedCommit}
        />
      )}
      {status === "recorded" && commits.length === 0 && (
        <NoDataView targetComponent={targetComponent} />
      )}
      {status === "recorded" && selectedCommit && (
        <RecordedView
          commits={commits}
          selectedCommitIndex={safeIndex}
          onSelectCommit={setSelectedCommitIndex}
          selectedCommit={selectedCommit}
        />
      )}
    </div>
  );
}

function ProfilerToolbar({
  status,
  sessions,
  activeSessionId,
  targetComponent,
  onStart,
  onStop,
  onClear,
  onLoadSession,
  onDeleteSession,
}: {
  status: string;
  sessions: ProfileSessionMeta[];
  activeSessionId: number | null;
  targetComponent: string;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onLoadSession: (id: number) => void;
  onDeleteSession: (id: number) => void;
}) {
  const target = targetComponent.trim();

  return (
    <div className="flex items-center border-b border-gray-700 shrink-0">
      {status === "recording" ? (
        <Tooltip content="Stop profiling">
          <button
            type="button"
            onClick={onStop}
            className="px-2 py-1.5 text-sm shrink-0 cursor-pointer focus:outline-none border-r border-gray-700 text-red-400 hover:bg-red-500/10"
          >
            <Square size={10} fill="currentColor" />
          </button>
        </Tooltip>
      ) : (
        <Tooltip content="Start profiling">
          <button
            type="button"
            onClick={onStart}
            className="px-2 py-1.5 text-sm shrink-0 cursor-pointer focus:outline-none border-r border-gray-700 text-blue-400 hover:bg-blue-500/10"
          >
            <Play size={12} fill="currentColor" />
          </button>
        </Tooltip>
      )}

      {status === "recorded" && (
        <Tooltip content="Start new profiling">
          <button
            type="button"
            onClick={onClear}
            className="px-2 py-1.5 text-sm shrink-0 cursor-pointer focus:outline-none border-r border-gray-700 text-gray-500 hover:text-gray-300"
          >
            <Plus size={14} />
          </button>
        </Tooltip>
      )}

      {target && (
        <div className="flex items-center gap-1.5 px-2 text-xs text-blue-400 shrink-0 border-r border-gray-700 py-1.5">
          <Crosshair size={12} />
          <span className="font-mono">{target}</span>
        </div>
      )}

      {sessions.length > 0 && status !== "recording" && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="px-2 py-1.5 text-sm shrink-0 cursor-pointer focus:outline-none border-r border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 flex items-center gap-1"
            >
              <span className="truncate max-w-[200px]">
                {activeSessionId
                  ? sessions.find((s) => s.id === activeSessionId)?.name ??
                    "Session"
                  : "Saved sessions"}
              </span>
              <ChevronDown size={12} />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              className="z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl min-w-[280px] py-1"
            >
              {sessions.map((s) => (
                <DropdownMenu.Item
                  key={s.id}
                  onSelect={() => onLoadSession(s.id)}
                  className={`flex items-center justify-between px-2 py-1.5 text-xs outline-none cursor-pointer data-[highlighted]:bg-gray-700 ${
                    s.id === activeSessionId
                      ? "text-blue-400"
                      : "text-gray-300"
                  }`}
                >
                  <span className="truncate flex-1">{s.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.id);
                    }}
                    className="p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-gray-300 shrink-0 ml-2"
                  >
                    <X size={12} />
                  </button>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}

function IdleView({
  targetComponent,
  targetTypeId,
  onTargetChange,
  componentNames,
}: {
  targetComponent: string;
  targetTypeId: number | null;
  onTargetChange: (name: string, typeId: number | null) => void;
  componentNames: ComponentNameEntry[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [flipUp, setFlipUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const queryLower = query.toLowerCase();
  const filtered = useMemo(
    () =>
      queryLower
        ? componentNames.filter((c) =>
            c.name.toLowerCase().includes(queryLower),
          )
        : componentNames,
    [componentNames, queryLower],
  );

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered.length, queryLower]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  // Flip dropdown upward if not enough space below
  useEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const dropdownMaxHeight = 192; // max-h-48 = 12rem = 192px
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    setFlipUp(spaceBelow < dropdownMaxHeight + margin);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const select = useCallback(
    (entry: ComponentNameEntry) => {
      const isSelected = entry.typeId != null
        ? targetTypeId === entry.typeId
        : targetComponent === entry.name;
      onTargetChange(isSelected ? "" : entry.name, isSelected ? null : entry.typeId);
      setQuery("");
      setOpen(false);
    },
    [targetTypeId, targetComponent, onTargetChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          setOpen(true);
          e.preventDefault();
        }
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[highlightIndex]) select(filtered[highlightIndex]);
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [open, filtered, highlightIndex, select],
  );

  const selectedEntry = targetTypeId != null
    ? componentNames.find((c) => c.typeId === targetTypeId)
    : targetComponent
      ? componentNames.find((c) => c.name === targetComponent)
      : null;

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-4">
      <Flame size={32} className="text-gray-600" />
      <p>Click the record button to start profiling.</p>
      <p className="text-xs text-gray-600">
        React will collect performance information while recording.
      </p>

      {componentNames.length > 0 && (
        <div className="w-72 mt-2" ref={containerRef}>
          <div className="flex items-center gap-1.5 mb-2 text-xs text-gray-400">
            <Crosshair size={12} />
            <span>Target component</span>
          </div>

          <div className="relative">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 z-10"
            />
            <input
              ref={inputRef}
              type="text"
              value={open ? query : targetComponent}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!open) setOpen(true);
              }}
              onFocus={() => {
                setQuery("");
                setOpen(true);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search components..."
              className={`w-full pl-6 py-1.5 text-xs bg-gray-800 border rounded text-gray-200 placeholder-gray-600 outline-none ${
                targetComponent && !open
                  ? "border-blue-500/50 pr-7"
                  : "border-gray-700 pr-2 focus:border-gray-500"
              }`}
            />
            {targetComponent && !open && (
              <button
                type="button"
                onClick={() => {
                  onTargetChange("", null);
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700 cursor-pointer"
              >
                <X size={12} />
              </button>
            )}

            {open && (
              <div
                ref={listRef}
                className={`absolute left-0 right-0 max-h-48 overflow-y-auto rounded border border-gray-700 bg-gray-800 shadow-xl z-20 ${
                  flipUp ? "bottom-full mb-1" : "top-full mt-1"
                }`}
              >
                {filtered.map((entry, i) => {
                  const isSelected = entry.typeId != null
                      ? targetTypeId === entry.typeId
                      : targetComponent === entry.name;
                  const isHighlighted = i === highlightIndex;
                  return (
                    <button
                      key={entry.typeId}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => select(entry)}
                      onMouseEnter={() => setHighlightIndex(i)}
                      className={`flex items-center w-full px-2 py-1.5 text-xs cursor-pointer ${
                        isHighlighted ? "bg-gray-700" : ""
                      } ${isSelected ? "text-blue-400" : "text-gray-300"}`}
                    >
                      <span className="w-4 shrink-0">
                        {isSelected && <Check size={12} />}
                      </span>
                      <span className="font-mono truncate">
                        {queryLower ? (
                          <HighlightedName name={entry.name} query={queryLower} />
                        ) : (
                          entry.name
                        )}
                      </span>
                      <span className="text-gray-500 text-[10px] ml-auto pl-2 shrink-0">
                        x{entry.count}
                      </span>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="px-2 py-3 text-xs text-gray-600 text-center">
                    No matching components
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedEntry && (
            <div className="mt-2 px-2 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 flex items-center gap-1.5">
              <Crosshair size={10} />
              <span className="font-mono truncate">{selectedEntry.name}</span>
              <span className="text-blue-400/50 text-[10px] ml-auto">
                {selectedEntry.count} instance{selectedEntry.count > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecordingView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-sm gap-3">
      <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
      <p className="text-gray-400">Profiling in progress...</p>
      <p className="text-xs text-gray-600">
        Interact with your app, then stop recording to see results.
      </p>
    </div>
  );
}

function NoDataView({ targetComponent }: { targetComponent: string }) {
  const target = targetComponent.trim();
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-3">
      <Flame size={32} className="text-gray-600" />
      <p>No profiling data recorded.</p>
      <p className="text-xs text-gray-600">
        {target
          ? `No instances of "${target}" re-rendered during the recording session.`
          : "The app did not re-render during the recording session."}
      </p>
    </div>
  );
}

function RecordedView({
  commits,
  selectedCommitIndex,
  onSelectCommit,
  selectedCommit,
}: {
  commits: ProfileCommitData[];
  selectedCommitIndex: number;
  onSelectCommit: (index: number) => void;
  selectedCommit: ProfileCommitData;
}) {
  const flameRef = useRef<HTMLDivElement>(null);
  const flameGraphRef = useRef<FlameGraphHandle>(null);
  useOverlayScrollbar(flameRef);

  const { bars, maxDepth } = useMemo(
    () =>
      selectedCommit.roots.length > 0 && selectedCommit.duration > 0
        ? flattenTree(selectedCommit.roots)
        : { bars: [] as FlatBar[], maxDepth: 0 },
    [selectedCommit],
  );

  const totalHeight = (maxDepth + 1) * ROW_HEIGHT;
  const [selectedBar, setSelectedBar] = useState<FlatBar | null>(null);

  // Reset selected bar when commit changes
  useEffect(() => {
    setSelectedBar(null);
  }, [selectedCommit]);

  const onFocusComponent = useCallback((nodeId: number) => {
    flameGraphRef.current?.zoomToBar(nodeId);
  }, []);

  const onHighlight = useCallback((nodeId: number, name: string) => {
    browser.devtools.inspectedWindow.eval(
      `window.postMessage({ type: "HIGHLIGHT_PROFILER_NODE", nodeId: ${nodeId}, nodeName: ${JSON.stringify(name)} }, "*")`,
    );
  }, []);

  const onHideHighlight = useCallback(() => {
    browser.devtools.inspectedWindow.eval(
      `window.postMessage({ type: "HIDE_HIGHLIGHT" }, "*")`,
    );
  }, []);

  const leftPanel = (
    <div className="flex flex-col flex-1 min-h-0">
      <CommitBar
        commits={commits}
        selectedIndex={selectedCommitIndex}
        onSelect={onSelectCommit}
      />
      <div ref={flameRef} className="flex-1 overflow-hidden">
        <FlameGraph
          ref={flameGraphRef}
          bars={bars}
          totalHeight={totalHeight}
          onBarSelect={setSelectedBar}
        />
      </div>
    </div>
  );

  const sidebar = (
    <div className="h-full">
      <div style={{ display: selectedBar ? "none" : undefined }}>
        <CommitSidebar
          commit={selectedCommit}
          commitIndex={selectedCommitIndex}
          totalCommits={commits.length}
          onFocusComponent={onFocusComponent}
          onHighlight={onHighlight}
          onHideHighlight={onHideHighlight}
        />
      </div>
      {selectedBar && <BarDetailSidebar bar={selectedBar} />}
    </div>
  );

  return <ResizablePanel left={leftPanel} right={sidebar} />;
}

function BarDetailSidebar({ bar }: { bar: FlatBar }) {
  const [hooks, setHooks] = useState<HookInfo[] | null>(null);

  // Fetch hook tree when bar changes
  useEffect(() => {
    setHooks(null);
    if (!bar.changedHookIndices?.length) return;

    (browser.devtools.inspectedWindow.eval as (
      expression: string,
      callback: (result: unknown, exceptionInfo: unknown) => void,
    ) => void)(
      `JSON.stringify(window.__REACT_DEV_TOOLKIT_INSPECT_PROFILER_HOOKS__(${bar.nodeId}))`,
      (result, exceptionInfo) => {
        if (!exceptionInfo && typeof result === "string") {
          try {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) setHooks(parsed as HookInfo[]);
          } catch {
            // parse failed
          }
        }
      },
    );
  }, [bar.nodeId, bar.changedHookIndices]);

  return (
    <div>
      <SidebarSection title="Component" defaultOpen>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-yellow-300 font-mono font-semibold truncate" title={bar.name}>
              {bar.name}
            </span>
            {bar.hocs?.map((h) => (
              <span
                key={h}
                className="px-1 rounded text-[10px] bg-gray-700 text-gray-300"
              >
                {h}
              </span>
            ))}
          </div>
          <SidebarRow
            icon={<Clock size={12} className="text-gray-500" />}
            label="Self time"
            value={`${bar.selfDuration.toFixed(1)}ms`}
          />
          <SidebarRow
            icon={<Clock size={12} className="text-gray-500" />}
            label="Total time"
            value={`${bar.totalDuration.toFixed(1)}ms`}
          />
          <SidebarRow
            icon={<Layers size={12} className="text-gray-500" />}
            label="Depth"
            value={`${bar.depth}`}
          />
          {!bar.didRender && (
            <div className="text-gray-500 text-[10px]">
              Did not render in this commit
            </div>
          )}
        </div>
      </SidebarSection>

      {bar.didRender && (
        <SidebarSection title="Why did this render?" defaultOpen>
          <div className="space-y-1">
            {bar.renderReasons && bar.renderReasons.length > 0 ? (
              bar.renderReasons.map((reason, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs">
                  <AlertCircle
                    size={12}
                    className="text-yellow-500 shrink-0 mt-0.5"
                  />
                  <span className="text-gray-300">{reason}</span>
                </div>
              ))
            ) : (
              <div className="text-xs text-gray-600">
                No render reason data available
              </div>
            )}
          </div>
        </SidebarSection>
      )}

      {bar.changedHookIndices && bar.changedHookIndices.length > 0 && hooks && (
        <SidebarSection title="Hooks" defaultOpen>
          <div className="space-y-0.5">
            {filterHooksWithChanges(hooks, bar.changedHookIndices).map((hook, i) => (
              <ProfilerHookEntry
                key={i}
                hook={hook}
                changedIds={bar.changedHookIndices!}
              />
            ))}
          </div>
        </SidebarSection>
      )}
    </div>
  );
}

/** Check if a hook or any of its descendants has an ID in the changed set */
function hookContainsChanged(hook: HookInfo, changedIds: number[]): boolean {
  if (hook.id !== null && changedIds.includes(hook.id)) return true;
  return hook.subHooks.some((sub) => hookContainsChanged(sub, changedIds));
}

/** Filter top-level hooks to only those containing changes */
function filterHooksWithChanges(hooks: HookInfo[], changedIds: number[]): HookInfo[] {
  return hooks.filter((h) => hookContainsChanged(h, changedIds));
}

function ProfilerHookEntry({
  hook,
  changedIds,
  depth = 0,
}: {
  hook: HookInfo;
  changedIds: number[];
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = hook.subHooks.length > 0;
  const isCustom = hasChildren;
  const isDirectlyChanged = hook.id !== null && changedIds.includes(hook.id);
  const nameColor = isCustom ? "text-yellow-300" : "text-blue-400";

  const changedChildren = hook.subHooks.filter((sub) =>
    hookContainsChanged(sub, changedIds),
  );

  return (
    <div style={depth > 0 ? { marginLeft: 12 } : undefined}>
      <div
        className={`text-xs min-w-0 rounded px-1 -mx-1 ${
          isDirectlyChanged ? "bg-yellow-500/15" : ""
        } ${hasChildren ? "cursor-pointer hover:bg-gray-800" : ""}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <span className="inline-flex items-center gap-1 align-middle">
          {hasChildren ? (
            <span className="text-gray-500 shrink-0">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className={nameColor}>
            {hook.name}
            {hook.id !== null && (
              <span className="text-gray-500"> ({hook.id})</span>
            )}
          </span>
          {isDirectlyChanged && (
            <span className="text-yellow-500 text-[10px]">changed</span>
          )}
        </span>
      </div>
      {expanded && hasChildren && (
        <div>
          {changedChildren.map((sub, i) => (
            <ProfilerHookEntry
              key={i}
              hook={sub}
              changedIds={changedIds}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommitSidebar({
  commit,
  commitIndex,
  totalCommits,
  onFocusComponent,
  onHighlight,
  onHideHighlight,
}: {
  commit: ProfileCommitData;
  commitIndex: number;
  totalCommits: number;
  onFocusComponent: (nodeId: number) => void;
  onHighlight: (nodeId: number, name: string) => void;
  onHideHighlight: () => void;
}) {
  const [rankedFilter, setRankedFilter] = useState("");
  const [grouped, setGrouped] = useState(false);
  const renderedComponents = collectRendered(commit.roots);
  renderedComponents.sort((a, b) => b.selfDuration - a.selfDuration);

  const filterLower = rankedFilter.toLowerCase();

  const rankedItems = useMemo(() => {
    const source = filterLower
      ? renderedComponents.filter((c) =>
          c.name.toLowerCase().includes(filterLower),
        )
      : renderedComponents;

    if (!grouped) {
      return source.map((c) => ({
        name: c.name,
        nodeId: c.nodeId,
        selfDuration: c.selfDuration,
        count: 1,
      }));
    }

    const map = new Map<string, { total: number; count: number; nodeId: number }>();
    for (const c of source) {
      const entry = map.get(c.name);
      if (entry) {
        entry.total += c.selfDuration;
        entry.count++;
      } else {
        map.set(c.name, { total: c.selfDuration, count: 1, nodeId: c.nodeId });
      }
    }

    return [...map.entries()]
      .map(([name, { total, count, nodeId }]) => ({ name, nodeId, selfDuration: total, count }))
      .sort((a, b) => b.selfDuration - a.selfDuration);
  }, [renderedComponents, filterLower, grouped]);

  return (
    <div>
      <SidebarSection title="Commit Info">
        <div className="space-y-2 text-xs">
          <SidebarRow
            icon={<Hash size={12} className="text-gray-500" />}
            label="Commit"
            value={`${commitIndex + 1} / ${totalCommits}`}
          />
          <SidebarRow
            icon={<Clock size={12} className="text-gray-500" />}
            label="Duration"
            value={`${commit.duration.toFixed(1)}ms`}
          />
          <SidebarRow
            icon={<Layers size={12} className="text-gray-500" />}
            label="Components"
            value={`${renderedComponents.length} rendered`}
          />
          <div className="text-[10px] text-gray-600">
            {new Date(commit.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </SidebarSection>

      <SidebarSection title="Ranked" defaultOpen>
        <div className="flex items-center gap-1 mt-1 mb-1.5">
          <div className="relative flex-1">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              type="text"
              value={rankedFilter}
              onChange={(e) => setRankedFilter(e.target.value)}
              placeholder="Filter components..."
              className="w-full pl-6 pr-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500"
            />
          </div>
          <Tooltip content={grouped ? "Ungroup" : "Group by name"}>
            <button
              type="button"
              onClick={() => setGrouped((g) => !g)}
              className={`p-1 rounded cursor-pointer ${
                grouped
                  ? "bg-blue-500/20 text-blue-400"
                  : "text-gray-500 hover:bg-gray-700 hover:text-gray-300"
              }`}
            >
              <Group size={14} />
            </button>
          </Tooltip>
        </div>
        <div className="space-y-0.5">
          {rankedItems.map((item, i) => {
            const nameEl = filterLower ? (
              <HighlightedName name={item.name} query={filterLower} />
            ) : (
              <span className="text-yellow-300 font-mono truncate mr-2">
                {item.name}
              </span>
            );

            return (
              <button
                type="button"
                key={`${item.name}-${i}`}
                onClick={() => onFocusComponent(item.nodeId)}
                onMouseEnter={() => onHighlight(item.nodeId, item.name)}
                onMouseLeave={onHideHighlight}
                className="flex items-center justify-between text-xs py-0.5 w-full cursor-pointer rounded hover:bg-gray-700/50 px-0.5"
              >
                <span className="flex items-center gap-1 truncate mr-2">
                  {nameEl}
                  {grouped && item.count > 1 && (
                    <span className="text-gray-500 text-[10px] shrink-0">
                      x{item.count}
                    </span>
                  )}
                </span>
                <span className="text-gray-500 whitespace-nowrap shrink-0">
                  {item.selfDuration.toFixed(1)}ms
                </span>
              </button>
            );
          })}
          {rankedItems.length === 0 && (
            <div className="text-xs text-gray-600">
              {rankedFilter
                ? "No matching components"
                : "No components rendered"}
            </div>
          )}
        </div>
      </SidebarSection>
    </div>
  );
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  const lower = name.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) {
    return (
      <span className="text-yellow-300 font-mono truncate mr-2">{name}</span>
    );
  }

  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + query.length);
  const after = name.slice(idx + query.length);

  return (
    <span className="text-yellow-300 font-mono truncate mr-2">
      {before}
      <span className="bg-yellow-400/30 text-yellow-200">{match}</span>
      {after}
    </span>
  );
}

function SidebarRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200 ml-auto">{value}</span>
    </div>
  );
}

function CommitBar({
  commits,
  selectedIndex,
  onSelect,
}: {
  commits: ProfileCommitData[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const maxDuration = Math.max(...commits.map((c) => c.duration));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && selectedIndex > 0) {
        e.preventDefault();
        onSelect(selectedIndex - 1);
      } else if (e.key === "ArrowRight" && selectedIndex < commits.length - 1) {
        e.preventDefault();
        onSelect(selectedIndex + 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIndex, commits.length, onSelect]);

  return (
    <div className="flex flex-col border-b border-gray-700 shrink-0">
      <div className="flex items-end gap-px px-3 pt-2 pb-1 overflow-x-auto h-12">
        {commits.map((commit, index) => {
          const height = Math.max(4, (commit.duration / maxDuration) * 32);
          const isSelected = index === selectedIndex;

          return (
            <button
              key={commit.id}
              type="button"
              onClick={() => onSelect(index)}
              className={`shrink-0 cursor-pointer transition-colors ${
                isSelected
                  ? "bg-blue-400"
                  : "bg-gray-600 hover:bg-gray-400"
              }`}
              style={{ height: `${height}px`, width: "3px" }}
              title={`Commit #${index + 1}: ${commit.duration.toFixed(1)}ms`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between px-3 pb-1.5">
        <span className="text-[10px] text-gray-500">
          Commit {selectedIndex + 1} / {commits.length}
        </span>
        <span className="text-[10px] text-gray-500">
          {commits[selectedIndex].duration.toFixed(1)}ms
        </span>
      </div>
    </div>
  );
}
