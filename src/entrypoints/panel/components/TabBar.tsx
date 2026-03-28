interface TabBarProps {
  tabs: readonly string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <nav className="flex">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onTabChange(tab)}
          className={`px-4 py-2 text-xs font-medium cursor-pointer focus:outline-none border-b-2 ${
            activeTab === tab
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
        >
          {tab}
        </button>
      ))}
    </nav>
  );
}
