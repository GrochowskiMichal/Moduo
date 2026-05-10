import "./timetracking-styles.css";
import { useState, useMemo } from "react";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { useTimetracking } from "../hooks/use-timetracking";
import { TimetrackingNav } from "./timetracking-nav";
import { TimelineView } from "./timeline-view";
import { DashboardView } from "./dashboard-view";
import { CategoriesView } from "./categories-view";
import { ProjectsView } from "./projects-view";
import { ReportsView } from "./reports-view";
import { FocusTimer } from "./focus-timer";
import type { TimetrackingView } from "../types";

function LeftPanel(props: {
  tt: ReturnType<typeof useTimetracking>;
}) {
  const { tt } = props;

  return (
    <div className="tt-left-panel">
      {/* Today Summary Card */}
      <div className="tt-summary-card">
        <div className="tt-summary-header">
          <span className="tt-summary-icon">📊</span>
          <span className="tt-summary-title">Today</span>
        </div>
        <div className="tt-summary-stats">
          <div className="tt-stat">
            <span className="tt-stat-value">{formatDuration(tt.todayTotalSeconds)}</span>
            <span className="tt-stat-label">tracked</span>
          </div>
          <div className="tt-stat">
            <span className="tt-stat-value">{tt.todayFocusScore}%</span>
            <span className="tt-stat-label">focus score</span>
          </div>
          <div className="tt-stat">
            <span className="tt-stat-value">{formatDuration(tt.todayProductiveSeconds)}</span>
            <span className="tt-stat-label">productive</span>
          </div>
        </div>
      </div>

      {/* Focus Timer */}
      <FocusTimer tt={tt} />

      {/* Tracking Controls */}
      <div className="tt-tracking-card">
        <div className="tt-tracking-header">
          <span className="tt-tracking-icon">{tt.isTracking ? "🔴" : "⏸️"}</span>
          <span className="tt-tracking-label">
            {tt.isTracking ? "Tracking Active" : "Tracking Paused"}
          </span>
        </div>
        <button
          className={`tt-tracking-btn ${tt.isTracking ? "tt-btn-stop" : "tt-btn-start"}`}
          onClick={() => tt.isTracking ? tt.stopTracking() : tt.startTracking()}
        >
          {tt.isTracking ? "Stop Tracking" : "Start Tracking"}
        </button>
      </div>

      {/* Quick Projects */}
      {tt.projects.length > 0 && (
        <div className="tt-quick-projects">
          <h4 className="tt-section-title">Projects</h4>
          {tt.projects.slice(0, 5).map(p => (
            <div className="tt-project-chip" key={p.id}>
              <span className="tt-project-dot" style={{ background: p.color }} />
              <span className="tt-project-name">{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RightPanel(props: {
  tt: ReturnType<typeof useTimetracking>;
}) {
  const { tt } = props;
  const recentEntries = useMemo(
    () => [...tt.todayEntries].reverse().slice(0, 20),
    [tt.todayEntries]
  );

  const categoryMap = useMemo(
    () => new Map(tt.categories.map(c => [c.id, c])),
    [tt.categories]
  );

  return (
    <div className="tt-right-panel">
      <h4 className="tt-section-title">Activity Feed</h4>
      {recentEntries.length === 0 ? (
        <div className="tt-empty-feed">
          <span className="tt-empty-icon">🌙</span>
          <p>No activity yet today</p>
          <p className="tt-empty-sub">Start tracking to see your activity here</p>
        </div>
      ) : (
        <div className="tt-feed-list">
          {recentEntries.map(entry => {
            const cat = entry.categoryId ? categoryMap.get(entry.categoryId) : null;
            return (
              <div className="tt-feed-item" key={entry.id}>
                <div
                  className="tt-feed-dot"
                  style={{ background: cat?.color ?? "#555" }}
                />
                <div className="tt-feed-content">
                  <span className="tt-feed-app">{entry.appName ?? "Manual"}</span>
                  <span className="tt-feed-time">
                    {formatTime(entry.startTime)} – {formatDuration(entry.duration)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TimetrackingWorkspace() {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  const [currentView, setCurrentView] = useState<TimetrackingView>("timeline");

  const tt = useTimetracking(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
  });

  const renderView = () => {
    switch (currentView) {
      case "timeline":
        return <TimelineView tt={tt} />;
      case "dashboard":
        return <DashboardView tt={tt} />;
      case "categories":
        return <CategoriesView tt={tt} />;
      case "projects":
        return <ProjectsView tt={tt} />;
      case "reports":
        return <ReportsView tt={tt} />;
      default:
        return <TimelineView tt={tt} />;
    }
  };

  return (
    <FeaturePanelsShell
      feature="timetracking"
      left={<LeftPanel tt={tt} />}
      center={
        <div className="tt-center">
          <TimetrackingNav view={currentView} onViewChange={setCurrentView} />
          <div className="tt-view-container">
            {tt.loading ? (
              <div className="tt-loading">
                <div className="tt-spinner" />
                <p>Loading time tracking data...</p>
              </div>
            ) : (
              renderView()
            )}
          </div>
        </div>
      }
      right={<RightPanel tt={tt} />}
    />
  );
}

// ─── Utility Functions ────────────────────────────────────────────────────────

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
