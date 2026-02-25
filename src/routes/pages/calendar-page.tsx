import { useCalendar } from "../../features/calendar/hooks/use-calendar";
import { CalendarWorkspace } from "../../features/calendar/ui/calendar-workspace";

export function CalendarPage() {
  const calendarState = useCalendar();
  return <CalendarWorkspace {...calendarState} />;
}
