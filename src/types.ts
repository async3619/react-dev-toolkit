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

export type MessageType =
  | { type: "SCAN_REACT_TREE" }
  | { type: "REACT_TREE_RESULT"; tree: ComponentNode[] | null; error?: string }
  | { type: "REACT_NOT_FOUND" };
