import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { UseTimetrackingState } from "../hooks/use-timetracking";

type Props = { tt: UseTimetrackingState };

export function FocusTimer({ tt }: Props) {
  const [showConfig, setShowConfig] = useState(false);
  const [targetMinutes, setTargetMinutes] = useState(25);
  const [label, setLabel] = useState("Deep Work");

  const activeSession = useMemo(
    () => tt.focusSessions.find(s => s.isActive),
    [tt.focusSessions]
  );

  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!activeSession) {
      setElapsed(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const startMs = new Date(activeSession.startTime).getTime();
    const update = () => {
      setElapsed(Math.floor((Date.now() - startMs) / 1000));
    };
    update();
    intervalRef.current = setInterval(update, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeSession]);

  const handleStart = useCallback(async () => {
    await tt.startFocusSession(targetMinutes, label);
    setShowConfig(false);
  }, [tt, targetMinutes, label]);

  const handleStop = useCallback(async () => {
    if (activeSession) {
      await tt.stopFocusSession(activeSession.id);
    }
  }, [tt, activeSession]);

  const targetSeconds = activeSession ? (activeSession.targetMinutes * 60) : (targetMinutes * 60);
  const progress = targetSeconds > 0 ? Math.min(1, elapsed / targetSeconds) : 0;
  const remaining = Math.max(0, targetSeconds - elapsed);
  const remainingMin = Math.floor(remaining / 60);
  const remainingSec = remaining % 60;
  const circumference = 2 * Math.PI * 44;

  return (
    <div className="tt-focus-widget">
      <div className="tt-focus-header">
        <span className="tt-focus-icon">🧘</span>
        <span className="tt-focus-widget-title">Focus Session</span>
      </div>

      {activeSession ? (
        <div className="tt-focus-active">
          <svg className="tt-focus-countdown" viewBox="0 0 100 100">
            <circle className="tt-countdown-bg" cx="50" cy="50" r="44" />
            <circle
              className="tt-countdown-fill"
              cx="50" cy="50" r="44"
              strokeDasharray={`${progress * circumference} ${circumference}`}
              style={{ stroke: progress >= 1 ? "#34D399" : "#60A5FA" }}
            />
          </svg>
          <div className="tt-countdown-text">
            <span className="tt-countdown-value">
              {String(remainingMin).padStart(2, "0")}:{String(remainingSec).padStart(2, "0")}
            </span>
            <span className="tt-countdown-label">{activeSession.label}</span>
          </div>
          <button className="tt-btn-stop-focus" onClick={handleStop}>
            End Session
          </button>
        </div>
      ) : (
        <div className="tt-focus-idle">
          {showConfig ? (
            <div className="tt-focus-config">
              <div className="tt-focus-preset-row">
                {[15, 25, 45, 60].map(m => (
                  <button
                    key={m}
                    className={`tt-focus-preset ${targetMinutes === m ? "tt-focus-preset-active" : ""}`}
                    onClick={() => setTargetMinutes(m)}
                  >
                    {m}m
                  </button>
                ))}
              </div>
              <input
                className="tt-input tt-focus-label-input"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Session label"
              />
              <button className="tt-btn-primary tt-btn-start-focus" onClick={handleStart}>
                Start Focus
              </button>
            </div>
          ) : (
            <button className="tt-btn-start-focus tt-btn-primary" onClick={() => setShowConfig(true)}>
              Start Focus Session
            </button>
          )}
        </div>
      )}
    </div>
  );
}
