import { useMemo, useState } from "react";
import type { UseTimetrackingState } from "../hooks/use-timetracking";
import { formatDuration } from "./timetracking-workspace";

type Props = { tt: UseTimetrackingState };

export function ReportsView({ tt }: Props) {
  const [reportRange, setReportRange] = useState<"week" | "month">("week");

  const categoryMap = useMemo(
    () => new Map(tt.categories.map(c => [c.id, c])),
    [tt.categories]
  );

  const rangeDays = useMemo(() => {
    const count = reportRange === "week" ? 7 : 30;
    const days: string[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return days;
  }, [reportRange]);

  const rangeStats = useMemo(() => {
    const relevantEntries = tt.entries.filter(e => {
      const day = e.startTime.slice(0, 10);
      return rangeDays.includes(day);
    });
    const totalSeconds = relevantEntries.reduce((s, e) => s + (e.duration || 0), 0);
    let productiveSeconds = 0;
    let distractingSeconds = 0;
    for (const e of relevantEntries) {
      const cat = e.categoryId ? categoryMap.get(e.categoryId) : null;
      if (cat && cat.productivityScore > 0) productiveSeconds += (e.duration || 0);
      else if (cat && cat.productivityScore < 0) distractingSeconds += (e.duration || 0);
    }
    const avgDaily = totalSeconds / rangeDays.length;
    const focusSessions = tt.focusSessions.filter(s => {
      const day = s.startTime.slice(0, 10);
      return rangeDays.includes(day);
    });
    return { totalSeconds, productiveSeconds, distractingSeconds, avgDaily, focusSessionCount: focusSessions.length };
  }, [tt.entries, tt.focusSessions, rangeDays, categoryMap]);

  // Category breakdown for range
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    const relevantEntries = tt.entries.filter(e => rangeDays.includes(e.startTime.slice(0, 10)));
    for (const e of relevantEntries) {
      const key = e.categoryId ?? "__uncategorized__";
      map.set(key, (map.get(key) ?? 0) + (e.duration || 0));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, seconds]) => ({
        name: id === "__uncategorized__" ? "Uncategorized" : (categoryMap.get(id)?.name ?? "Unknown"),
        color: id === "__uncategorized__" ? "#666" : (categoryMap.get(id)?.color ?? "#888"),
        icon: id === "__uncategorized__" ? "❓" : (categoryMap.get(id)?.icon ?? ""),
        seconds,
      }));
  }, [tt.entries, rangeDays, categoryMap]);

  // Heatmap data (daily totals)
  const heatmapData = useMemo(() => {
    return rangeDays.map(day => {
      const summary = tt.dailySummaries.find(s => s.date === day);
      return { date: day, total: summary?.totalTrackedSeconds ?? 0 };
    });
  }, [rangeDays, tt.dailySummaries]);

  const maxHeatmap = useMemo(() => Math.max(...heatmapData.map(d => d.total), 1), [heatmapData]);

  return (
    <div className="tt-reports">
      {/* Range Selector */}
      <div className="tt-report-range">
        <button className={`tt-range-btn ${reportRange === "week" ? "tt-range-active" : ""}`} onClick={() => setReportRange("week")}>This Week</button>
        <button className={`tt-range-btn ${reportRange === "month" ? "tt-range-active" : ""}`} onClick={() => setReportRange("month")}>This Month</button>
      </div>

      {/* Summary Cards */}
      <div className="tt-report-cards">
        <div className="tt-report-card">
          <span className="tt-report-card-value">{formatDuration(rangeStats.totalSeconds)}</span>
          <span className="tt-report-card-label">Total Tracked</span>
        </div>
        <div className="tt-report-card tt-stat-productive">
          <span className="tt-report-card-value">{formatDuration(rangeStats.productiveSeconds)}</span>
          <span className="tt-report-card-label">Productive</span>
        </div>
        <div className="tt-report-card tt-stat-distracting">
          <span className="tt-report-card-value">{formatDuration(rangeStats.distractingSeconds)}</span>
          <span className="tt-report-card-label">Distracting</span>
        </div>
        <div className="tt-report-card">
          <span className="tt-report-card-value">{formatDuration(rangeStats.avgDaily)}</span>
          <span className="tt-report-card-label">Daily Average</span>
        </div>
        <div className="tt-report-card">
          <span className="tt-report-card-value">{rangeStats.focusSessionCount}</span>
          <span className="tt-report-card-label">Focus Sessions</span>
        </div>
      </div>

      {/* Category Table */}
      <div className="tt-report-section">
        <h3 className="tt-section-title">Category Breakdown</h3>
        <table className="tt-report-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Time</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {categoryBreakdown.map(cat => (
              <tr key={cat.name}>
                <td>
                  <span className="tt-report-cat">
                    <span className="tt-report-cat-dot" style={{ background: cat.color }} />
                    {cat.icon} {cat.name}
                  </span>
                </td>
                <td>{formatDuration(cat.seconds)}</td>
                <td>{rangeStats.totalSeconds > 0 ? Math.round((cat.seconds / rangeStats.totalSeconds) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Activity Heatmap */}
      <div className="tt-report-section">
        <h3 className="tt-section-title">Daily Activity</h3>
        <div className="tt-heatmap">
          {heatmapData.map(d => {
            const intensity = d.total / maxHeatmap;
            return (
              <div className="tt-heatmap-cell" key={d.date} title={`${d.date}: ${formatDuration(d.total)}`}>
                <div
                  className="tt-heatmap-fill"
                  style={{
                    opacity: Math.max(0.1, intensity),
                    background: intensity > 0.6 ? "#34D399" : intensity > 0.3 ? "#60A5FA" : "#94A3B8",
                  }}
                />
                <span className="tt-heatmap-label">
                  {new Date(d.date + "T12:00:00").toLocaleDateString([], { day: "numeric" })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
