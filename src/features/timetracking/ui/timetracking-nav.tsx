import type { TimetrackingView } from "../types";

const VIEW_TABS: Array<{ key: TimetrackingView; label: string; icon: string }> = [
  { key: "timeline",   label: "Timeline",   icon: "⏱️" },
  { key: "dashboard",  label: "Dashboard",  icon: "📊" },
  { key: "categories", label: "Categories", icon: "🏷️" },
  { key: "projects",   label: "Projects",   icon: "📁" },
  { key: "reports",    label: "Reports",    icon: "📈" },
];

type Props = {
  view: TimetrackingView;
  onViewChange: (view: TimetrackingView) => void;
};

export function TimetrackingNav({ view, onViewChange }: Props) {
  return (
    <nav className="tt-nav">
      <div className="tt-nav-tabs">
        {VIEW_TABS.map(tab => (
          <button
            key={tab.key}
            className={`tt-nav-tab ${view === tab.key ? "tt-nav-tab-active" : ""}`}
            onClick={() => onViewChange(tab.key)}
          >
            <span className="tt-nav-tab-icon">{tab.icon}</span>
            <span className="tt-nav-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
