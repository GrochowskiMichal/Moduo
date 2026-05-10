import{j as e}from"./jsx-runtime-u17CrQMm.js";import{r as t}from"./index-B3d2A58Q.js";function I({tt:a}){const[k,m]=t.useState(!1),[u,p]=t.useState(25),[s,w]=t.useState("Deep Work"),n=t.useMemo(()=>a.focusSessions.find(r=>r.isActive),[a.focusSessions]),[d,o]=t.useState(0),i=t.useRef(null);t.useEffect(()=>{if(!n){o(0),i.current&&clearInterval(i.current);return}const r=new Date(n.startTime).getTime(),v=()=>{o(Math.floor((Date.now()-r)/1e3))};return v(),i.current=setInterval(v,1e3),()=>{i.current&&clearInterval(i.current)}},[n]);const q=t.useCallback(async()=>{await a.startFocusSession(u,s),m(!1)},[a,u,s]),b=t.useCallback(async()=>{n&&await a.stopFocusSession(n.id)},[a,n]),l=n?n.targetMinutes*60:u*60,g=l>0?Math.min(1,d/l):0,c=Math.max(0,l-d),P=Math.floor(c/60),A=c%60,y=2*Math.PI*44;return e.jsxs("div",{className:"tt-focus-widget",children:[e.jsxs("div",{className:"tt-focus-header",children:[e.jsx("span",{className:"tt-focus-icon",children:"🧘"}),e.jsx("span",{className:"tt-focus-widget-title",children:"Focus Session"})]}),n?e.jsxs("div",{className:"tt-focus-active",children:[e.jsxs("svg",{className:"tt-focus-countdown",viewBox:"0 0 100 100",children:[e.jsx("circle",{className:"tt-countdown-bg",cx:"50",cy:"50",r:"44"}),e.jsx("circle",{className:"tt-countdown-fill",cx:"50",cy:"50",r:"44",strokeDasharray:`${g*y} ${y}`,style:{stroke:g>=1?"#34D399":"#60A5FA"}})]}),e.jsxs("div",{className:"tt-countdown-text",children:[e.jsxs("span",{className:"tt-countdown-value",children:[String(P).padStart(2,"0"),":",String(A).padStart(2,"0")]}),e.jsx("span",{className:"tt-countdown-label",children:n.label})]}),e.jsx("button",{className:"tt-btn-stop-focus",onClick:b,children:"End Session"})]}):e.jsx("div",{className:"tt-focus-idle",children:k?e.jsxs("div",{className:"tt-focus-config",children:[e.jsx("div",{className:"tt-focus-preset-row",children:[15,25,45,60].map(r=>e.jsxs("button",{className:`tt-focus-preset ${u===r?"tt-focus-preset-active":""}`,onClick:()=>p(r),children:[r,"m"]},r))}),e.jsx("input",{className:"tt-input tt-focus-label-input",value:s,onChange:r=>w(r.target.value),placeholder:"Session label"}),e.jsx("button",{className:"tt-btn-primary tt-btn-start-focus",onClick:q,children:"Start Focus"})]}):e.jsx("button",{className:"tt-btn-start-focus tt-btn-primary",onClick:()=>m(!0),children:"Start Focus Session"})})]})}I.__docgenInfo={description:"",methods:[],displayName:"FocusTimer",props:{tt:{required:!0,tsType:{name:"signature",type:"object",raw:`{
  entries: TimeEntry[];
  categories: TimeCategory[];
  rules: CategoryRule[];
  projects: TimeProject[];
  focusSessions: FocusSession[];
  isTracking: boolean;
  loading: boolean;
  // CRUD
  createEntry: (entry: Partial<TimeEntry>) => Promise<string | null>;
  updateEntry: (id: string, patch: Partial<TimeEntry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  createCategory: (category: Partial<TimeCategory>) => Promise<string | null>;
  updateCategory: (id: string, patch: Partial<TimeCategory>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  createRule: (rule: Partial<CategoryRule>) => Promise<string | null>;
  deleteRule: (id: string) => Promise<void>;
  createProject: (project: Partial<TimeProject>) => Promise<string | null>;
  updateProject: (id: string, patch: Partial<TimeProject>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  startFocusSession: (targetMinutes: number, label?: string) => Promise<string | null>;
  stopFocusSession: (id: string) => Promise<void>;
  // Tracking
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  refreshData: () => Promise<void>;
  // Computed
  dailySummaries: DailySummary[];
  todayEntries: TimeEntry[];
  todayTotalSeconds: number;
  todayProductiveSeconds: number;
  todayFocusScore: number;
}`,signature:{properties:[{key:"entries",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"duration",value:{name:"number",required:!0}},{key:"appName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"windowTitle",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"url",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"projectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"isManual",value:{name:"boolean",required:!0}},{key:"isMeeting",value:{name:"boolean",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TimeEntry[]",required:!0}},{key:"categories",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"color",value:{name:"string",required:!0}},{key:"icon",value:{name:"string",required:!0}},{key:"productivityScore",value:{name:"union",raw:"-1 | -0.5 | 0 | 0.5 | 1",elements:[{name:"literal",value:"-1"},{name:"literal",value:"-0.5"},{name:"literal",value:"0"},{name:"literal",value:"0.5"},{name:"literal",value:"1"}],required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TimeCategory[]",required:!0}},{key:"rules",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"categoryId",value:{name:"string",required:!0}},{key:"matchType",value:{name:"union",raw:'"app" | "url" | "keyword" | "window_title"',elements:[{name:"literal",value:'"app"'},{name:"literal",value:'"url"'},{name:"literal",value:'"keyword"'},{name:"literal",value:'"window_title"'}],required:!0}},{key:"matchValue",value:{name:"string",required:!0}},{key:"isAiGenerated",value:{name:"boolean",required:!0}},{key:"confidence",value:{name:"number",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"CategoryRule[]",required:!0}},{key:"projects",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"color",value:{name:"string",required:!0}},{key:"clientName",value:{name:"string",required:!0}},{key:"budgetHours",value:{name:"union",raw:"number | null",elements:[{name:"number"},{name:"null"}],required:!0}},{key:"linkedTaskProjectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TimeProject[]",required:!0}},{key:"focusSessions",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"targetMinutes",value:{name:"number",required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"label",value:{name:"string",required:!0}},{key:"isActive",value:{name:"boolean",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"FocusSession[]",required:!0}},{key:"isTracking",value:{name:"boolean",required:!0}},{key:"loading",value:{name:"boolean",required:!0}},{key:"createEntry",value:{name:"signature",type:"function",raw:"(entry: Partial<TimeEntry>) => Promise<string | null>",signature:{arguments:[{type:{name:"Partial",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"duration",value:{name:"number",required:!0}},{key:"appName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"windowTitle",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"url",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"projectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"isManual",value:{name:"boolean",required:!0}},{key:"isMeeting",value:{name:"boolean",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"Partial<TimeEntry>"},name:"entry"}],return:{name:"Promise",elements:[{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]}],raw:"Promise<string | null>"}},required:!0}},{key:"updateEntry",value:{name:"signature",type:"function",raw:"(id: string, patch: Partial<TimeEntry>) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"id"},{type:{name:"Partial",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"duration",value:{name:"number",required:!0}},{key:"appName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"windowTitle",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"url",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"projectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"isManual",value:{name:"boolean",required:!0}},{key:"isMeeting",value:{name:"boolean",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"Partial<TimeEntry>"},name:"patch"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"deleteEntry",value:{name:"signature",type:"function",raw:"(id: string) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"createCategory",value:{name:"signature",type:"function",raw:"(category: Partial<TimeCategory>) => Promise<string | null>",signature:{arguments:[{type:{name:"Partial",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"color",value:{name:"string",required:!0}},{key:"icon",value:{name:"string",required:!0}},{key:"productivityScore",value:{name:"union",raw:"-1 | -0.5 | 0 | 0.5 | 1",elements:[{name:"literal",value:"-1"},{name:"literal",value:"-0.5"},{name:"literal",value:"0"},{name:"literal",value:"0.5"},{name:"literal",value:"1"}],required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"Partial<TimeCategory>"},name:"category"}],return:{name:"Promise",elements:[{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]}],raw:"Promise<string | null>"}},required:!0}},{key:"updateCategory",value:{name:"signature",type:"function",raw:"(id: string, patch: Partial<TimeCategory>) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"id"},{type:{name:"Partial",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"color",value:{name:"string",required:!0}},{key:"icon",value:{name:"string",required:!0}},{key:"productivityScore",value:{name:"union",raw:"-1 | -0.5 | 0 | 0.5 | 1",elements:[{name:"literal",value:"-1"},{name:"literal",value:"-0.5"},{name:"literal",value:"0"},{name:"literal",value:"0.5"},{name:"literal",value:"1"}],required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"Partial<TimeCategory>"},name:"patch"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"deleteCategory",value:{name:"signature",type:"function",raw:"(id: string) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"createRule",value:{name:"signature",type:"function",raw:"(rule: Partial<CategoryRule>) => Promise<string | null>",signature:{arguments:[{type:{name:"Partial",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"categoryId",value:{name:"string",required:!0}},{key:"matchType",value:{name:"union",raw:'"app" | "url" | "keyword" | "window_title"',elements:[{name:"literal",value:'"app"'},{name:"literal",value:'"url"'},{name:"literal",value:'"keyword"'},{name:"literal",value:'"window_title"'}],required:!0}},{key:"matchValue",value:{name:"string",required:!0}},{key:"isAiGenerated",value:{name:"boolean",required:!0}},{key:"confidence",value:{name:"number",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"Partial<CategoryRule>"},name:"rule"}],return:{name:"Promise",elements:[{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]}],raw:"Promise<string | null>"}},required:!0}},{key:"deleteRule",value:{name:"signature",type:"function",raw:"(id: string) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"createProject",value:{name:"signature",type:"function",raw:"(project: Partial<TimeProject>) => Promise<string | null>",signature:{arguments:[{type:{name:"Partial",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"color",value:{name:"string",required:!0}},{key:"clientName",value:{name:"string",required:!0}},{key:"budgetHours",value:{name:"union",raw:"number | null",elements:[{name:"number"},{name:"null"}],required:!0}},{key:"linkedTaskProjectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"Partial<TimeProject>"},name:"project"}],return:{name:"Promise",elements:[{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]}],raw:"Promise<string | null>"}},required:!0}},{key:"updateProject",value:{name:"signature",type:"function",raw:"(id: string, patch: Partial<TimeProject>) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"id"},{type:{name:"Partial",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"color",value:{name:"string",required:!0}},{key:"clientName",value:{name:"string",required:!0}},{key:"budgetHours",value:{name:"union",raw:"number | null",elements:[{name:"number"},{name:"null"}],required:!0}},{key:"linkedTaskProjectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"Partial<TimeProject>"},name:"patch"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"deleteProject",value:{name:"signature",type:"function",raw:"(id: string) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"startFocusSession",value:{name:"signature",type:"function",raw:"(targetMinutes: number, label?: string) => Promise<string | null>",signature:{arguments:[{type:{name:"number"},name:"targetMinutes"},{type:{name:"string"},name:"label"}],return:{name:"Promise",elements:[{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]}],raw:"Promise<string | null>"}},required:!0}},{key:"stopFocusSession",value:{name:"signature",type:"function",raw:"(id: string) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"startTracking",value:{name:"signature",type:"function",raw:"() => Promise<void>",signature:{arguments:[],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"stopTracking",value:{name:"signature",type:"function",raw:"() => Promise<void>",signature:{arguments:[],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"refreshData",value:{name:"signature",type:"function",raw:"() => Promise<void>",signature:{arguments:[],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}},required:!0}},{key:"dailySummaries",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  date: string;            // YYYY-MM-DD
  totalTrackedSeconds: number;
  productiveSeconds: number;
  distractingSeconds: number;
  neutralSeconds: number;
  focusScore: number;      // 0..100
  topCategories: Array<{ categoryId: string; seconds: number }>;
  focusSessionCount: number;
}`,signature:{properties:[{key:"date",value:{name:"string",required:!0}},{key:"totalTrackedSeconds",value:{name:"number",required:!0}},{key:"productiveSeconds",value:{name:"number",required:!0}},{key:"distractingSeconds",value:{name:"number",required:!0}},{key:"neutralSeconds",value:{name:"number",required:!0}},{key:"focusScore",value:{name:"number",required:!0}},{key:"topCategories",value:{name:"Array",elements:[{name:"signature",type:"object",raw:"{ categoryId: string; seconds: number }",signature:{properties:[{key:"categoryId",value:{name:"string",required:!0}},{key:"seconds",value:{name:"number",required:!0}}]}}],raw:"Array<{ categoryId: string; seconds: number }>",required:!0}},{key:"focusSessionCount",value:{name:"number",required:!0}}]}}],raw:"DailySummary[]",required:!0}},{key:"todayEntries",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"duration",value:{name:"number",required:!0}},{key:"appName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"windowTitle",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"url",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"projectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"isManual",value:{name:"boolean",required:!0}},{key:"isMeeting",value:{name:"boolean",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TimeEntry[]",required:!0}},{key:"todayTotalSeconds",value:{name:"number",required:!0}},{key:"todayProductiveSeconds",value:{name:"number",required:!0}},{key:"todayFocusScore",value:{name:"number",required:!0}}]}},description:""}}};export{I as F};
