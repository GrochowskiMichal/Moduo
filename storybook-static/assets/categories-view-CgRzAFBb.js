import{j as e}from"./jsx-runtime-u17CrQMm.js";import{r as t}from"./index-B3d2A58Q.js";function T({tt:n}){const[h,i]=t.useState(!1),[j,u]=t.useState(!1),[s,y]=t.useState(""),[m,v]=t.useState("#60A5FA"),[o,p]=t.useState("⏱️"),[g,k]=t.useState(0),[l,w]=t.useState(""),[c,q]=t.useState("app"),[d,b]=t.useState(""),P=t.useCallback(async()=>{s.trim()&&(await n.createCategory({name:s,color:m,icon:o,productivityScore:g}),i(!1),y(""),v("#60A5FA"),p("⏱️"),k(0))},[n,s,m,o,g]),A=t.useCallback(async()=>{!l||!d.trim()||(await n.createRule({categoryId:l,matchType:c,matchValue:d}),u(!1),w(""),q("app"),b(""))},[n,l,c,d]),I=[{value:1,label:"Productive"},{value:.5,label:"Somewhat Productive"},{value:0,label:"Neutral"},{value:-.5,label:"Somewhat Distracting"},{value:-1,label:"Distracting"}],N=["⏱️","⌨️","💬","🎨","🔍","✍️","📅","📱","🎮","📋","📚","🧪","🔧","🎧","📧","🌐"];return e.jsxs("div",{className:"tt-categories",children:[e.jsxs("div",{className:"tt-categories-section",children:[e.jsxs("div",{className:"tt-section-header",children:[e.jsx("h3",{className:"tt-section-title",children:"Categories"}),e.jsx("button",{className:"tt-btn-add-sm",onClick:()=>i(!0),children:"+ Add"})]}),e.jsx("div",{className:"tt-category-grid",children:n.categories.map(r=>e.jsxs("div",{className:"tt-category-card",children:[e.jsxs("div",{className:"tt-category-card-header",children:[e.jsxs("div",{className:"tt-category-badge",style:{background:r.color+"22",color:r.color},children:[e.jsx("span",{children:r.icon}),e.jsx("span",{children:r.name})]}),e.jsx("button",{className:"tt-btn-delete-sm",onClick:()=>n.deleteCategory(r.id),title:"Delete category",children:"×"})]}),e.jsx("div",{className:"tt-category-score",children:e.jsx("span",{className:`tt-score-badge ${r.productivityScore>0?"tt-score-pos":r.productivityScore<0?"tt-score-neg":"tt-score-neutral"}`,children:r.productivityScore>0?"Productive":r.productivityScore<0?"Distracting":"Neutral"})}),e.jsx("div",{className:"tt-category-rules",children:n.rules.filter(a=>a.categoryId===r.id).map(a=>e.jsxs("div",{className:"tt-rule-chip",children:[e.jsx("span",{className:"tt-rule-type",children:a.matchType}),e.jsx("span",{className:"tt-rule-value",children:a.matchValue}),a.isAiGenerated&&e.jsx("span",{className:"tt-rule-ai",children:"✨"}),e.jsx("button",{className:"tt-rule-delete",onClick:()=>n.deleteRule(a.id),children:"×"})]},a.id))})]},r.id))}),n.categories.length===0&&e.jsxs("div",{className:"tt-empty-categories",children:[e.jsx("span",{className:"tt-empty-icon",children:"🏷️"}),e.jsx("p",{children:"No categories yet. Create your first category to start organizing your time."})]})]}),e.jsxs("div",{className:"tt-categories-section",children:[e.jsxs("div",{className:"tt-section-header",children:[e.jsx("h3",{className:"tt-section-title",children:"Auto-Classification Rules"}),e.jsx("button",{className:"tt-btn-add-sm",onClick:()=>u(!0),disabled:n.categories.length===0,children:"+ Add Rule"})]}),n.rules.length===0&&e.jsxs("div",{className:"tt-empty-categories",children:[e.jsx("span",{className:"tt-empty-icon",children:"🤖"}),e.jsx("p",{children:"No rules yet. Add rules to automatically categorize your time entries based on app names, window titles, or keywords."})]})]}),h&&e.jsx("div",{className:"tt-modal-overlay",onClick:()=>i(!1),children:e.jsxs("div",{className:"tt-modal",onClick:r=>r.stopPropagation(),children:[e.jsx("h3",{children:"New Category"}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Name"}),e.jsx("input",{className:"tt-input",value:s,onChange:r=>y(r.target.value),placeholder:"e.g. Development",autoFocus:!0})]}),e.jsxs("div",{className:"tt-form-row",children:[e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Color"}),e.jsx("input",{className:"tt-input",type:"color",value:m,onChange:r=>v(r.target.value)})]}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Icon"}),e.jsx("div",{className:"tt-icon-grid",children:N.map(r=>e.jsx("button",{className:`tt-icon-option ${o===r?"tt-icon-selected":""}`,onClick:()=>p(r),children:r},r))})]})]}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Productivity"}),e.jsx("select",{className:"tt-input",value:g,onChange:r=>k(parseFloat(r.target.value)),children:I.map(r=>e.jsx("option",{value:r.value,children:r.label},r.value))})]}),e.jsxs("div",{className:"tt-form-actions",children:[e.jsx("button",{className:"tt-btn-cancel",onClick:()=>i(!1),children:"Cancel"}),e.jsx("button",{className:"tt-btn-primary",onClick:P,children:"Create"})]})]})}),j&&e.jsx("div",{className:"tt-modal-overlay",onClick:()=>u(!1),children:e.jsxs("div",{className:"tt-modal",onClick:r=>r.stopPropagation(),children:[e.jsx("h3",{children:"New Classification Rule"}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Category"}),e.jsxs("select",{className:"tt-input",value:l,onChange:r=>w(r.target.value),children:[e.jsx("option",{value:"",children:"Select category..."}),n.categories.map(r=>e.jsxs("option",{value:r.id,children:[r.icon," ",r.name]},r.id))]})]}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Match Type"}),e.jsxs("select",{className:"tt-input",value:c,onChange:r=>q(r.target.value),children:[e.jsx("option",{value:"app",children:"App Name"}),e.jsx("option",{value:"window_title",children:"Window Title"}),e.jsx("option",{value:"url",children:"URL"}),e.jsx("option",{value:"keyword",children:"Keyword (any)"})]})]}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Match Value"}),e.jsx("input",{className:"tt-input",value:d,onChange:r=>b(r.target.value),placeholder:"e.g. Visual Studio Code"})]}),e.jsxs("div",{className:"tt-form-actions",children:[e.jsx("button",{className:"tt-btn-cancel",onClick:()=>u(!1),children:"Cancel"}),e.jsx("button",{className:"tt-btn-primary",onClick:A,children:"Create Rule"})]})]})})]})}T.__docgenInfo={description:"",methods:[],displayName:"CategoriesView",props:{tt:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"duration",value:{name:"number",required:!0}},{key:"appName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"windowTitle",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"url",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"projectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"isManual",value:{name:"boolean",required:!0}},{key:"isMeeting",value:{name:"boolean",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TimeEntry[]",required:!0}},{key:"todayTotalSeconds",value:{name:"number",required:!0}},{key:"todayProductiveSeconds",value:{name:"number",required:!0}},{key:"todayFocusScore",value:{name:"number",required:!0}}]}},description:""}}};export{T as C};
