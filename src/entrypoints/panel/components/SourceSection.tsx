import { Code, ExternalLink } from "lucide-react";
import type { ComponentNode } from "@/types";
import { cleanSourcePath } from "../utils/format";
import { openInEditor, openInSource } from "../utils/source";
import { SidebarSection } from "./SidebarSection";

interface SourceSectionProps {
  node: ComponentNode;
}

export function SourceSection({ node }: SourceSectionProps) {
  const { sourceLocation, source } = node;

  if (!sourceLocation) return null;

  const { fileName, lineNumber, columnNumber } = sourceLocation;
  const displayPath = cleanSourcePath(fileName);

  return (
    <SidebarSection title="Source">
      <div className="space-y-1.5 text-xs">
        <div className="flex gap-2 min-w-0">
          <span className="text-gray-500 shrink-0">File</span>
          <span className="text-green-400 truncate" title={displayPath}>
            {displayPath}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-500 shrink-0">Line</span>
          <span className="text-gray-300">
            {lineNumber}
            {columnNumber != null && `:${columnNumber}`}
          </span>
        </div>
        {source && (
          <div className="flex gap-2">
            <span className="text-gray-500 shrink-0">Type</span>
            <span className={source === "first-party" ? "text-blue-400" : "text-gray-400"}>
              {source === "first-party" ? "First-party" : "Third-party"}
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            className="flex items-center justify-center gap-1 px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer transition-colors"
            onClick={() => openInEditor(displayPath, lineNumber, columnNumber)}
          >
            <ExternalLink size={12} />
            Editor
          </button>
          <button
            type="button"
            className="flex items-center justify-center gap-1 px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white cursor-pointer transition-colors"
            onClick={() => openInSource(node.id)}
          >
            <Code size={12} />
            Sources
          </button>
        </div>
      </div>
    </SidebarSection>
  );
}
