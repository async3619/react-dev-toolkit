export interface SourceLocation {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

export type HocBadge = "memo" | "forwardRef" | "lazy";

export interface ComponentNode {
  id: number;
  name: string;
  typeId?: number;
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

export interface DiffTreeNode {
  key: string;
  prevValue?: string;
  nextValue?: string;
  changed?: boolean;
  children?: DiffTreeNode[];
}

export interface ChangedProp {
  name: string;
  prevValue: string;
  nextValue: string;
  diffTree?: DiffTreeNode[];
}

export interface ChangedContext {
  name: string;
  prevValue: string;
  nextValue: string;
  diffTree?: DiffTreeNode[];
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
  /** Props that changed between renders (prev/next values) */
  changedProps?: ChangedProp[];
  /** Contexts that changed between renders (prev/next values) */
  changedContexts?: ChangedContext[];
}

export type MessageType =
  | { type: "SCAN_REACT_TREE" }
  | { type: "REACT_TREE_RESULT"; tree: ComponentNode[] | null; error?: string }
  | { type: "REACT_NOT_FOUND" }
  | { type: "START_PROFILING"; targetTypeId?: number; targetComponent?: string }
  | { type: "STOP_PROFILING" }
  | { type: "PROFILING_COMMIT"; commit: ProfileCommitData };
