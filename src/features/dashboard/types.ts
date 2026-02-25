export type WidgetType = "notes" | "tasks" | "clock" | "weather" | "stock" | "crypto" | "pomodoro" | "hydration" | "countdown";

export type StockEntry = {
  symbol: string;
  name: string;
};

export type CryptoEntry = {
  id: string;
  symbol: string;
  name: string;
};

export type WidgetConfig = {
  noteId?: string;
  projectIds?: string[];
  timezones?: string[];
  weatherCity?: string;
  weatherLat?: number;
  weatherLon?: number;
  stocks?: StockEntry[];
  cryptos?: CryptoEntry[];
  pomodoroWorkMinutes?: number;
  pomodoroBreakMinutes?: number;
  hydrationGoalMl?: number;
  hydrationConsumedMl?: number;
  hydrationLastDate?: string;
  countdownTitle?: string;
  countdownTargetIso?: string;
  countdownActive?: boolean;
};

export type WidgetInstance = {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig;
};

export type DashboardLayout = {
  isLocked: boolean;
  widgets: WidgetInstance[];
};
