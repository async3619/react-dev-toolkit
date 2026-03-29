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

export interface ProfileCommitData {
  id: number;
  duration: number;
  timestamp: number;
  roots: ProfileFiberNode[];
}

export interface ProfileFiberNode {
  nodeId: number;
  name: string;
  hocs?: HocBadge[];
  selfDuration: number;
  totalDuration: number;
  /** Baseline render cost — used for width of non-rendered nodes */
  baseDuration: number;
  children: ProfileFiberNode[];
  didRender: boolean;
  renderReasons?: string[];
  /** 1-based hook IDs that changed (excluding effect hooks) */
  changedHookIndices?: number[];
}

export type MessageType =
  | { type: "SCAN_REACT_TREE" }
  | { type: "REACT_TREE_RESULT"; tree: ComponentNode[] | null; error?: string }
  | { type: "REACT_NOT_FOUND" }
  | { type: "START_PROFILING" }
  | { type: "STOP_PROFILING" }
  | { type: "PROFILING_COMMIT"; commit: ProfileCommitData };
