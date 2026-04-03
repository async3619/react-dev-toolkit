import type { SourceMapConsumer } from "source-map-js";

// Re-export bippy's Fiber type as the canonical fiber type for the scanner
export type { Fiber } from "bippy";

export interface SourceLocation {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

export type HocBadge = "memo" | "forwardRef" | "lazy";

export interface ComponentNode {
  id: number;
  name: string;
  typeId: number;
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

export type { SourceMapConsumer };
