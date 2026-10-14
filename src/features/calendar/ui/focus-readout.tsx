// The live focus readout on a Calendar block (CAL-5), now on the one time
// engine (TV-F6): the same clock as the top-bar timer and Focus. Its own
// component, so only this span redraws each second; the grid and chip stay
// off the per-second path.

import { formatFocusClock } from "../../focus/clock";
import { useFocusTimer } from "../../focus/timer";

type Props = {
  className?: string;
};

export function FocusReadout({ className }: Props) {
  const timer = useFocusTimer();
  if (timer.timer === "off") {
    return <span className={className}>Focus</span>;
  }
  const clock = formatFocusClock(timer.bigClock);
  const label =
    timer.timer === "pomodoro" ? `${timer.phaseLabel} ${clock} left` : `Focused ${clock}`;
  return (
    <span role="timer" className={className} aria-label={label}>
      {clock}
    </span>
  );
}
