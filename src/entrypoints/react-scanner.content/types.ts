export interface FiberNode {
  tag: number;
  type: unknown;
  child: FiberNode | null;
  sibling: FiberNode | null;
  return: FiberNode | null;
  memoizedProps: Record<string, unknown>;
  memoizedState: unknown;
  stateNode: unknown;
  dependencies?: { firstContext: unknown } | null;
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number };
}

export interface SourceLocation {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

export type HocBadge = "memo" | "forwardRef" | "lazy";

export interface ComponentNode {
  id: number;
  name: string;
  hocs?: HocBadge[];
  props: Record<string, unknown>;
  children: ComponentNode[];
  source?: "first-party" | "third-party";
  sourceLocation?: SourceLocation;
}

export interface FiberNameResult {
  name: string;
  hocs: HocBadge[];
}

export interface ComponentSourceInfo {
  classification: "first-party" | "third-party" | undefined;
  location?: SourceLocation;
}

export interface ScriptEntry {
  content: string;
  consumer: SourceMapConsumer | null;
}

export interface SourceCacheEntry {
  classification: "first-party" | "third-party" | undefined;
  location?: SourceLocation;
}

export interface HookSource {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

export interface HookInfo {
  id: number | null;
  name: string;
  value: unknown;
  subHooks: HookInfo[];
  source?: HookSource | null;
}

export interface HookLogEntry {
  primitive: string;
  dispatcherHookName: string;
  stackError: Error;
  value: unknown;
  displayName: string | null;
  debugValue?: unknown;
  subHooks: HookLogEntry[];
}

export interface DispatcherRef {
  get: () => unknown;
  set: (v: unknown) => void;
}

export type HookType = {
  onCommitFiberRoot?: (...args: unknown[]) => void;
  inject?: (renderer: unknown) => number;
  renderers?: Map<number, unknown>;
};

// Re-export for convenience
import type { SourceMapConsumer } from "source-map-js";
export type { SourceMapConsumer };
