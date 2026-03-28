export interface ComponentNode {
  id: number;
  name: string;
  props: Record<string, unknown>;
  children: ComponentNode[];
  source?: "first-party" | "third-party";
}

export type MessageType =
  | { type: "SCAN_REACT_TREE" }
  | { type: "REACT_TREE_RESULT"; tree: ComponentNode[] | null; error?: string }
  | { type: "REACT_NOT_FOUND" };
