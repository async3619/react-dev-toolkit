import { useComponentTreeStore } from "../stores/componentTreeStore";
import { ComponentTree } from "./ComponentTree";

export function ComponentsTab() {
  const status = useComponentTreeStore((s) => s.status);
  const tree = useComponentTreeStore((s) => s.tree);
  const error = useComponentTreeStore((s) => s.error);

  if (status === "idle") {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Detecting React components...
      </div>
    );
  }

  if (status === "not-found") {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        No React application detected on this page.
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
        Error: {error}
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        React detected, but no components found.
      </div>
    );
  }

  return <ComponentTree />;
}
