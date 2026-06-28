export type WidgetType = "notes" | "clock" | "weather" | "stock" | "crypto" | "pomodoro" | "hydration" | "countdown" | "todolist" | "job-tracker" | "recently-linked" | "contacts-needs-attention" | "contacts-reconnect";

export type TodoListItem = {
  id: string;
  text: string;
  done: boolean;
};

export type JobSalaryUnit = "hour" | "day" | "week" | "month" | "year";

export type JobApplicationStage =
  | "applied"
  | "rejected"
  | "replied"
  | "preinterview"
  | "interview"
  | "technical"
  | "behavioral"
  | "staff"
  | "decision"
  | "hired";

export type JobApplicationEntry = {
  id: string;
  applicationDate: string;
  offerLink: string;
  positionName: string;
  companyName: string;
  salaryAmount: string;
  salaryUnit: JobSalaryUnit;
  stage: JobApplicationStage;
};

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
  todoListTitle?: string;
  todoListItems?: TodoListItem[];
  jobApplications?: JobApplicationEntry[];
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
