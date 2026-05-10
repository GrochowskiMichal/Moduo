// ─── Timetracking Feature Types ───────────────────────────────────────────────

/** Productivity classification for a category (-1 = distracting, 0 = neutral, 1 = productive) */
export type ProductivityScore = -1 | -0.5 | 0 | 0.5 | 1;

/** A tracked time segment */
export type TimeEntry = {
  id: string;
  workspaceId: string;
  ownerId: string;
  startTime: string;       // ISO 8601
  endTime: string;         // ISO 8601
  duration: number;        // seconds
  appName: string | null;
  windowTitle: string | null;
  url: string | null;
  categoryId: string | null;
  projectId: string | null;
  isManual: boolean;
  isMeeting: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** A time category (e.g. "Development", "Communication", "Design") */
export type TimeCategory = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  color: string;
  icon: string;
  productivityScore: ProductivityScore;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** Match type for auto-classification rules */
export type RuleMatchType = "app" | "url" | "keyword" | "window_title";

/** Auto-classification rule */
export type CategoryRule = {
  id: string;
  workspaceId: string;
  ownerId: string;
  categoryId: string;
  matchType: RuleMatchType;
  matchValue: string;       // regex or exact-match pattern
  isAiGenerated: boolean;
  confidence: number;       // 0..1
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** A client/project to allocate time to */
export type TimeProject = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  color: string;
  clientName: string;
  budgetHours: number | null;
  linkedTaskProjectId: string | null; // links to tasks feature project
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** A focus/deep-work session */
export type FocusSession = {
  id: string;
  workspaceId: string;
  ownerId: string;
  startTime: string;
  endTime: string | null;
  targetMinutes: number;
  categoryId: string | null;
  label: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** Aggregated daily productivity stats */
export type DailySummary = {
  date: string;            // YYYY-MM-DD
  totalTrackedSeconds: number;
  productiveSeconds: number;
  distractingSeconds: number;
  neutralSeconds: number;
  focusScore: number;      // 0..100
  topCategories: Array<{ categoryId: string; seconds: number }>;
  focusSessionCount: number;
};

/** Raw activity snapshot from OS-level capture */
export type ActivitySnapshot = {
  timestamp: string;
  appName: string;
  windowTitle: string;
  url: string | null;
  idle: boolean;
};

// ─── View / Nav Types ─────────────────────────────────────────────────────────

export type TimetrackingView = "timeline" | "dashboard" | "categories" | "projects" | "reports";

export type DateDensity = "day" | "week" | "month";

export type TimetrackingNavState = {
  view: TimetrackingView;
  density: DateDensity;
  categoryFilter: string | null;
  projectFilter: string | null;
  productivityFilter: "all" | "productive" | "distracting" | "neutral";
};

// ─── Default Categories ───────────────────────────────────────────────────────

export const DEFAULT_CATEGORIES: Array<Omit<TimeCategory, "id" | "workspaceId" | "ownerId" | "createdAt" | "updatedAt" | "deletedAt">> = [
  { name: "Development",    color: "#60A5FA", icon: "⌨️",  productivityScore: 1,    position: "a01" },
  { name: "Communication",  color: "#F59E0B", icon: "💬",  productivityScore: 0,    position: "a02" },
  { name: "Design",         color: "#A78BFA", icon: "🎨",  productivityScore: 1,    position: "a03" },
  { name: "Research",       color: "#34D399", icon: "🔍",  productivityScore: 0.5,  position: "a04" },
  { name: "Writing",        color: "#F472B6", icon: "✍️",  productivityScore: 1,    position: "a05" },
  { name: "Meetings",       color: "#FB923C", icon: "📅",  productivityScore: 0,    position: "a06" },
  { name: "Social Media",   color: "#EF4444", icon: "📱",  productivityScore: -1,   position: "a07" },
  { name: "Entertainment",  color: "#F87171", icon: "🎮",  productivityScore: -1,   position: "a08" },
  { name: "Admin",          color: "#94A3B8", icon: "📋",  productivityScore: 0.5,  position: "a09" },
  { name: "Learning",       color: "#2DD4BF", icon: "📚",  productivityScore: 1,    position: "a10" },
];
