import { useState, useMemo, useCallback } from "react";
import type { UseTimetrackingState } from "../hooks/use-timetracking";
import { formatDuration, formatTime } from "./timetracking-workspace";

type Props = { tt: UseTimetrackingState };

const HOUR_HEIGHT = 60; // pixels per hour

export function TimelineView({ tt }: Props) {
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualDesc, setManualDesc] = useState("");
  const [manualCategoryId, setManualCategoryId] = useState<string>("");
  const [manualHours, setManualHours] = useState(1);
  const [manualMinutes, setManualMinutes] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  const categoryMap = useMemo(
    () => new Map(tt.categories.map(c => [c.id, c])),
    [tt.categories]
  );

  const dayEntries = useMemo(() => {
    return tt.entries
      .filter(e => e.startTime.startsWith(selectedDate))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [tt.entries, selectedDate]);

  // Map entries to grid positions + inject idle gaps
  const timelineBlocks = useMemo(() => {
    const blocks: any[] = [];
    
    dayEntries.forEach((entry, idx) => {
      // Check for gap with previous entry
      if (idx > 0) {
        const prevEntry = dayEntries[idx - 1];
        const gapSeconds = (new Date(entry.startTime).getTime() - new Date(prevEntry.endTime).getTime()) / 1000;
        
        // If gap > 5 mins (300s), create an idle block
        if (gapSeconds >= 300) {
          const dStartGap = new Date(prevEntry.endTime);
          const startMinutesGap = dStartGap.getHours() * 60 + dStartGap.getMinutes();
          const topGap = (startMinutesGap / 60) * HOUR_HEIGHT;
          const heightGap = Math.max((gapSeconds / 3600) * HOUR_HEIGHT, 15);
          
          blocks.push({
            id: `idle-${prevEntry.id}`,
            isIdle: true,
            top: topGap,
            height: heightGap,
            color: "#4B5563", // Gray
            appName: "Break / Idle",
            duration: gapSeconds,
            startTime: prevEntry.endTime,
            endTime: entry.startTime,
            icon: "☕",
          });
        }
      }

      const dStart = new Date(entry.startTime);
      const startMinutes = dStart.getHours() * 60 + dStart.getMinutes();
      const top = (startMinutes / 60) * HOUR_HEIGHT;
      const height = Math.max((entry.duration / 3600) * HOUR_HEIGHT, 15); // min 15px height

      const cat = entry.categoryId ? categoryMap.get(entry.categoryId) : null;
      
      blocks.push({
        ...entry,
        isIdle: false,
        top,
        height,
        color: cat?.color ?? "#9CA3AF",
        catName: cat?.name,
        icon: cat?.icon,
      });
    });
    
    return blocks;
  }, [dayEntries, categoryMap]);

  const totalDaySeconds = useMemo(
    () => dayEntries.reduce((s, e) => s + (e.duration || 0), 0),
    [dayEntries]
  );

  const handleAddManual = useCallback(async () => {
    const totalSeconds = manualHours * 3600 + manualMinutes * 60;
    if (totalSeconds <= 0) return;
    const now = new Date();
    const startTime = new Date(now.getTime() - totalSeconds * 1000).toISOString();
    await tt.createEntry({
      startTime,
      endTime: now.toISOString(),
      duration: totalSeconds,
      description: manualDesc || "Manual entry",
      categoryId: manualCategoryId || null,
      isManual: true,
    });
    setShowManualForm(false);
    setManualDesc("");
    setManualHours(1);
    setManualMinutes(0);
    setManualCategoryId("");
  }, [tt, manualDesc, manualCategoryId, manualHours, manualMinutes]);

  const navigateDate = useCallback((dir: -1 | 1) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + dir);
    setSelectedDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  }, [selectedDate]);

  const isToday = useMemo(() => {
    const d = new Date();
    return selectedDate === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [selectedDate]);

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="tt-timeline-v2">
      {/* Header controls */}
      <div className="tt-timeline-header">
        <div className="tt-date-picker">
          <button className="tt-icon-btn" onClick={() => navigateDate(-1)}>◀</button>
          <button className="tt-date-display" onClick={() => {
            const d = new Date();
            setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
          }}>
            {isToday ? "Today" : new Date(selectedDate + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
          </button>
          <button className="tt-icon-btn" onClick={() => navigateDate(1)}>▶</button>
        </div>
        <div className="tt-timeline-actions">
          <span className="tt-timeline-total">{formatDuration(totalDaySeconds)} tracked</span>
          <button className="tt-btn-add-sm" onClick={() => setShowManualForm(true)}>+ Add Time</button>
        </div>
      </div>

      {/* Vertical schedule grid */}
      <div className="tt-schedule-container">
        <div className="tt-schedule-grid" style={{ height: 24 * HOUR_HEIGHT }}>
          {/* Hour lines */}
          {hours.map(hour => (
            <div className="tt-hour-row" key={hour} style={{ top: hour * HOUR_HEIGHT }}>
              <div className="tt-hour-label">
                {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
              </div>
              <div className="tt-hour-line" />
            </div>
          ))}

          {/* Time blocks */}
          <div className="tt-blocks-layer">
            {timelineBlocks.map(block => (
              <div
                key={block.id}
                className={`tt-time-block ${block.isIdle ? "tt-block-idle" : ""}`}
                style={{
                  top: block.top,
                  height: block.height,
                  background: `${block.color}1A`, // 10% opacity
                  borderLeftColor: block.color,
                }}
              >
                <div className="tt-block-content">
                  <div className="tt-block-title">
                    {(block.appName ?? block.description) || "Untitled"}
                  </div>
                  {block.height >= 30 && (
                    <div className="tt-block-meta">
                      {block.icon && <span className="tt-block-icon">{block.icon}</span>}
                      <span className="tt-block-time">{formatDuration(block.duration)}</span>
                    </div>
                  )}
                </div>
                
                {/* Hover UI */}
                <div className="tt-block-hover">
                  <div className="tt-block-tooltip">
                    <div className="tt-tt-header">
                      <strong>{block.appName ?? "Manual"}</strong>
                      <span className="tt-tt-dur">{formatDuration(block.duration)}</span>
                    </div>
                    {block.windowTitle && <div className="tt-tt-window">{block.windowTitle}</div>}
                    <div className="tt-tt-time">{formatTime(block.startTime)} - {formatTime(block.endTime)}</div>
                    {block.catName && (
                      <div className="tt-tt-cat">
                        <span className="tt-tt-dot" style={{ background: block.color }} />
                        {block.catName}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Current time indicator (if today) */}
          {isToday && (
            <div 
              className="tt-current-time-line" 
              style={{ 
                top: (new Date().getHours() + new Date().getMinutes() / 60) * HOUR_HEIGHT 
              }} 
            >
              <div className="tt-current-time-dot" />
            </div>
          )}
        </div>
      </div>

      {/* Manual Entry Form */}
      {showManualForm && (
        <div className="tt-modal-overlay" onClick={() => setShowManualForm(false)}>
          <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Manual Time</h3>
            <div className="tt-form-group">
              <label>What were you doing?</label>
              <input
                className="tt-input"
                placeholder="Description..."
                value={manualDesc}
                onChange={e => setManualDesc(e.target.value)}
                autoFocus
              />
            </div>
            <div className="tt-form-row">
              <div className="tt-form-group">
                <label>Hours</label>
                <input
                  className="tt-input"
                  type="number"
                  min={0}
                  max={23}
                  value={manualHours}
                  onChange={e => setManualHours(parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="tt-form-group">
                <label>Minutes</label>
                <input
                  className="tt-input"
                  type="number"
                  min={0}
                  max={59}
                  value={manualMinutes}
                  onChange={e => setManualMinutes(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="tt-form-group">
              <label>Category</label>
              <select
                className="tt-input"
                value={manualCategoryId}
                onChange={e => setManualCategoryId(e.target.value)}
              >
                <option value="">None</option>
                {tt.categories.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
            <div className="tt-form-actions">
              <button className="tt-btn-cancel" onClick={() => setShowManualForm(false)}>Cancel</button>
              <button className="tt-btn-primary" onClick={handleAddManual}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
