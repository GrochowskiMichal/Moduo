
export type WidgetType = "notes" | "tasks" | "clock";

export interface WidgetConfig {
  // Notes specific
  noteId?: string;

  // Tasks specific
  projectIds?: string[]; // If empty, all projects
  tags?: string[]; // Filter by tags
  viewMode?: "list" | "board";

  // Clock specific
  timezones?: string[]; // Array of timezone strings (e.g., "America/New_York")
}

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig;
}

export interface DashboardView {
  id: string;
  name: string;
  widgets: WidgetInstance[];
}
