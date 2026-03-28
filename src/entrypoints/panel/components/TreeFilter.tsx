interface TreeFilterProps {
  value: string;
  onChange: (value: string) => void;
  inspecting: boolean;
  onToggleInspect: () => void;
}

export function TreeFilter({ value, onChange, inspecting, onToggleInspect }: TreeFilterProps) {
  return (
    <div className="flex items-center border-b border-gray-700 shrink-0">
      <button
        type="button"
        onClick={onToggleInspect}
        title="Click to inspect an element on the page"
        className={`px-2 py-1.5 text-sm shrink-0 cursor-pointer focus:outline-none border-r border-gray-700 ${
          inspecting ? "text-blue-400 bg-blue-500/10" : "text-gray-500 hover:text-gray-300"
        }`}
      >
        ⊙
      </button>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter components..."
        className="flex-1 px-3 py-1.5 text-xs bg-transparent border-none focus:outline-none placeholder-gray-500"
      />
    </div>
  );
}
