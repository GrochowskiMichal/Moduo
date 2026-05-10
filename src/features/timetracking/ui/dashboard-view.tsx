import { useMemo } from "react";
import type { UseTimetrackingState } from "../hooks/use-timetracking";
import { formatDuration } from "./timetracking-workspace";

type Props = { tt: UseTimetrackingState };

export function DashboardView({ tt }: Props) {
  const categoryMap = useMemo(
    () => new Map(tt.categories.map(c => [c.id, c])),
    [tt.categories]
  );

  // Category breakdown for today
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of tt.todayEntries) {
      const key = entry.categoryId ?? "__uncategorized__";
      map.set(key, (map.get(key) ?? 0) + (entry.duration || 0));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, seconds]) => ({
        id,
        name: id === "__uncategorized__" ? "Uncategorized" : (categoryMap.get(id)?.name ?? "Unknown"),
        color: id === "__uncategorized__" ? "#666" : (categoryMap.get(id)?.color ?? "#888"),
        icon: id === "__uncategorized__" ? "❓" : (categoryMap.get(id)?.icon ?? ""),
        seconds,
        pct: tt.todayTotalSeconds > 0 ? Math.round((seconds / tt.todayTotalSeconds) * 100) : 0,
      }));
  }, [tt.todayEntries, tt.todayTotalSeconds, categoryMap]);

  // Top apps today
  const topApps = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of tt.todayEntries) {
      const key = entry.appName ?? "Unknown";
      map.set(key, (map.get(key) ?? 0) + (entry.duration || 0));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, seconds]) => ({ name, seconds }));
  }, [tt.todayEntries]);

  // Weekly trend (last 7 days)
  const weeklyTrend = useMemo(() => {
    const days: Array<{ date: string; total: number; productive: number; score: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const summary = tt.dailySummaries.find(s => s.date === dateStr);
      days.push({
        date: dateStr,
        total: summary?.totalTrackedSeconds ?? 0,
        productive: summary?.productiveSeconds ?? 0,
        score: summary?.focusScore ?? 0,
      });
    }
    return days;
  }, [tt.dailySummaries]);

  const maxWeeklyTotal = useMemo(
    () => Math.max(...weeklyTrend.map(d => d.total), 1),
    [weeklyTrend]
  );

  return (
    <div className="tt-dashboard">
      {/* Focus Score Ring */}
      <div className="tt-dash-hero">
        <div className="tt-focus-ring-wrapper">
          <svg className="tt-focus-ring" viewBox="0 0 120 120">
            <circle className="tt-ring-bg" cx="60" cy="60" r="52" />
            <circle
              className="tt-ring-fill"
              cx="60" cy="60" r="52"
              strokeDasharray={`${(tt.todayFocusScore / 100) * 327} 327`}
              style={{
                stroke: tt.todayFocusScore >= 70 ? "#34D399" : tt.todayFocusScore >= 40 ? "#F59E0B" : "#EF4444",
                filter: `drop-shadow(0 0 8px ${tt.todayFocusScore >= 70 ? "rgba(52,211,153,0.5)" : tt.todayFocusScore >= 40 ? "rgba(245,158,11,0.5)" : "rgba(239,68,68,0.5)"})`,
              }}
            />
          </svg>
          <div className="tt-focus-ring-value">
            <span className="tt-focus-number">{tt.todayFocusScore}</span>
            <span className="tt-focus-unit">%</span>
          </div>
        </div>
        <div className="tt-focus-label">Focus Score</div>
      </div>

      {/* Stats Row */}
      <div className="tt-dash-stats-row">
        <div className="tt-dash-stat-card">
          <span className="tt-dash-stat-icon">⏱️</span>
          <span className="tt-dash-stat-value">{formatDuration(tt.todayTotalSeconds)}</span>
          <span className="tt-dash-stat-label">Total Tracked</span>
        </div>
        <div className="tt-dash-stat-card tt-stat-productive">
          <span className="tt-dash-stat-icon">🎯</span>
          <span className="tt-dash-stat-value">{formatDuration(tt.todayProductiveSeconds)}</span>
          <span className="tt-dash-stat-label">Productive</span>
        </div>
        <div className="tt-dash-stat-card tt-stat-distracting">
          <span className="tt-dash-stat-icon">📱</span>
          <span className="tt-dash-stat-value">
            {formatDuration(tt.todayEntries.reduce((s, e) => {
              const cat = e.categoryId ? categoryMap.get(e.categoryId) : null;
              return s + (cat && cat.productivityScore < 0 ? (e.duration || 0) : 0);
            }, 0))}
          </span>
          <span className="tt-dash-stat-label">Distracting</span>
        </div>
        <div className="tt-dash-stat-card">
          <span className="tt-dash-stat-icon">🧘</span>
          <span className="tt-dash-stat-value">{tt.focusSessions.filter(s => {
            const d = new Date();
            const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
            return s.startTime.startsWith(todayStr);
          }).length}</span>
          <span className="tt-dash-stat-label">Focus Sessions</span>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="tt-dash-section">
        <h3 className="tt-dash-section-title">Time by Category</h3>
        {categoryBreakdown.length === 0 ? (
          <p className="tt-dash-empty">No categorized time yet</p>
        ) : (
          <div className="tt-category-bars">
            {categoryBreakdown.map(cat => (
              <div className="tt-cat-bar-row" key={cat.id}>
                <div className="tt-cat-bar-label">
                  <span>{cat.icon} {cat.name}</span>
                  <span className="tt-cat-bar-time">{formatDuration(cat.seconds)} ({cat.pct}%)</span>
                </div>
                <div className="tt-cat-bar-track">
                  <div
                    className="tt-cat-bar-fill"
                    style={{ width: `${cat.pct}%`, background: cat.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Apps */}
      <div className="tt-dash-section">
        <h3 className="tt-dash-section-title">Top Apps</h3>
        {topApps.length === 0 ? (
          <p className="tt-dash-empty">No app data yet</p>
        ) : (
          <div className="tt-top-apps">
            {topApps.map((app, i) => (
              <div className="tt-app-row" key={app.name}>
                <span className="tt-app-rank">{i + 1}</span>
                <span className="tt-app-name">{app.name}</span>
                <div className="tt-app-bar-track">
                  <div
                    className="tt-app-bar-fill"
                    style={{
                      width: `${Math.round((app.seconds / (topApps[0]?.seconds || 1)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="tt-app-time">{formatDuration(app.seconds)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Weekly Trend */}
      <div className="tt-dash-section">
        <h3 className="tt-dash-section-title">Weekly Trend</h3>
        <div className="tt-weekly-chart">
          {weeklyTrend.map(day => (
            <div className="tt-weekly-bar-col" key={day.date}>
              <div className="tt-weekly-bar-wrapper">
                <div
                  className="tt-weekly-bar tt-bar-total"
                  style={{ height: `${(day.total / maxWeeklyTotal) * 100}%` }}
                />
                <div
                  className="tt-weekly-bar tt-bar-productive"
                  style={{ height: `${(day.productive / maxWeeklyTotal) * 100}%` }}
                />
              </div>
              <span className="tt-weekly-label">
                {new Date(day.date + "T12:00:00").toLocaleDateString([], { weekday: "narrow" })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
