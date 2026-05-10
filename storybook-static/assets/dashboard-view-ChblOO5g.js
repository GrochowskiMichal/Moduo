import{j as e}from"./jsx-runtime-u17CrQMm.js";import{r as a}from"./index-B3d2A58Q.js";import{F as ye}from"./feature-panels-shell-BdfMhs37.js";import{u as ve}from"./auth-provider-doCjk4pR.js";import{u as pe}from"./workspace-provider-BUsyo879.js";import{T as ke}from"./timetracking-nav-B8N9aZGk.js";import{C as we}from"./categories-view-CgRzAFBb.js";import{F as qe}from"./focus-timer-CvI5r51J.js";function O(){return typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}function j(){return new Date().toISOString()}function be(n){return{id:n.id,workspaceId:n.workspaceId??n.workspace_id,ownerId:n.ownerId??n.owner_id,startTime:n.startTime??n.start_time,endTime:n.endTime??n.end_time,duration:n.duration??n.durationSecs??n.duration_secs??0,appName:n.appName??n.app_name??null,windowTitle:n.windowTitle??n.window_title??null,url:n.url??null,categoryId:n.categoryId??n.category_id??null,projectId:n.projectId??n.project_id??null,isManual:!!(n.isManual??n.is_manual),isMeeting:!!(n.isMeeting??n.is_meeting),description:n.description??"",createdAt:n.createdAt??n.created_at??j(),updatedAt:n.updatedAt??n.updated_at??j(),deletedAt:n.deletedAt??n.deleted_at??null}}function Pe(n){return{id:n.id,workspaceId:n.workspaceId??n.workspace_id,ownerId:n.ownerId??n.owner_id,name:n.name??"",color:n.color??"#888",icon:n.icon??"⏱️",productivityScore:n.productivityScore??n.productivity_score??0,position:n.position??"z99",createdAt:n.createdAt??n.created_at??j(),updatedAt:n.updatedAt??n.updated_at??j(),deletedAt:n.deletedAt??n.deleted_at??null}}function je(n){return{id:n.id,workspaceId:n.workspaceId??n.workspace_id,ownerId:n.ownerId??n.owner_id,categoryId:n.categoryId??n.category_id,matchType:n.matchType??n.match_type??"app",matchValue:n.matchValue??n.match_value??"",isAiGenerated:!!(n.isAiGenerated??n.is_ai_generated),confidence:n.confidence??1,createdAt:n.createdAt??n.created_at??j(),updatedAt:n.updatedAt??n.updated_at??j(),deletedAt:n.deletedAt??n.deleted_at??null}}function he(n){return{id:n.id,workspaceId:n.workspaceId??n.workspace_id,ownerId:n.ownerId??n.owner_id,name:n.name??"",color:n.color??"#888",clientName:n.clientName??n.client_name??"",budgetHours:n.budgetHours??n.budget_hours??null,linkedTaskProjectId:n.linkedTaskProjectId??n.linked_task_project_id??null,createdAt:n.createdAt??n.created_at??j(),updatedAt:n.updatedAt??n.updated_at??j(),deletedAt:n.deletedAt??n.deleted_at??null}}function Ae(n){return{id:n.id,workspaceId:n.workspaceId??n.workspace_id,ownerId:n.ownerId??n.owner_id,startTime:n.startTime??n.start_time,endTime:n.endTime??n.end_time??null,targetMinutes:n.targetMinutes??n.target_minutes??25,categoryId:n.categoryId??n.category_id??null,label:n.label??"",isActive:!!(n.isActive??n.is_active),createdAt:n.createdAt??n.created_at??j(),updatedAt:n.updatedAt??n.updated_at??j(),deletedAt:n.deletedAt??n.deleted_at??null}}function Ie(n,o){const{userId:l,workspaceId:u}=o,[v,w]=a.useState([]),[i,s]=a.useState([]),[p,d]=a.useState([]),[q,c]=a.useState([]),[b,k]=a.useState([]),[h,I]=a.useState(!1),[A,D]=a.useState(!0),y=a.useCallback(async()=>{if(!n||!u)return;const r=await n.timetracking.list(u);w((r.entries??[]).map(be)),s((r.categories??[]).map(Pe)),d((r.rules??[]).map(je)),c((r.projects??[]).map(he)),k((r.focusSessions??r.focus_sessions??[]).map(Ae));const m=await n.timetracking.getTrackingStatus();I(m.isTracking)},[n,u]);a.useEffect(()=>{if(!n||!u){D(!1);return}let r=!0;return(async()=>{D(!0);try{await y()}finally{r&&D(!1)}})(),()=>{r=!1}},[y,n,u]),a.useEffect(()=>{if(!h||!n||!u)return;const r=setInterval(()=>{y()},1e4);return()=>clearInterval(r)},[h,y,n,u]);const V=a.useCallback(async r=>{if(!n||!l||!u)return null;const m=j(),g={id:O(),workspaceId:u,ownerId:l,startTime:r.startTime??m,endTime:r.endTime??m,durationSecs:r.duration??0,appName:r.appName??null,windowTitle:r.windowTitle??null,url:r.url??null,categoryId:r.categoryId??null,projectId:r.projectId??null,isManual:r.isManual??!0,isMeeting:r.isMeeting??!1,description:r.description??"",createdAt:m,updatedAt:m,deletedAt:null};return await n.timetracking.upsertEntry(g),await y(),g.id},[n,l,u,y]),B=a.useCallback(async(r,m)=>{if(!n)return;const g=v.find(f=>f.id===r);if(!g)return;const T={...g,...m,durationSecs:m.duration??g.duration,updatedAt:j()};await n.timetracking.upsertEntry(T),await y()},[n,v,y]),t=a.useCallback(async r=>{n&&(await n.timetracking.deleteEntry(r),await y())},[n,y]),P=a.useCallback(async r=>{if(!n||!l||!u)return null;const m=j(),g={id:O(),workspaceId:u,ownerId:l,name:r.name??"New Category",color:r.color??"#888",icon:r.icon??"⏱️",productivityScore:r.productivityScore??0,position:r.position??`z${String(i.length+1).padStart(2,"0")}`,createdAt:m,updatedAt:m,deletedAt:null};return await n.timetracking.upsertCategory(g),await y(),g.id},[n,l,u,i.length,y]),_=a.useCallback(async(r,m)=>{if(!n)return;const g=i.find(f=>f.id===r);if(!g)return;const T={...g,...m,updatedAt:j()};await n.timetracking.upsertCategory(T),await y()},[n,i,y]),G=a.useCallback(async r=>{n&&(await n.timetracking.deleteCategory(r),await y())},[n,y]),te=a.useCallback(async r=>{if(!n||!l||!u)return null;const m=j(),g={id:O(),workspaceId:u,ownerId:l,categoryId:r.categoryId??"",matchType:r.matchType??"app",matchValue:r.matchValue??"",isAiGenerated:r.isAiGenerated??!1,confidence:r.confidence??1,createdAt:m,updatedAt:m,deletedAt:null};return await n.timetracking.upsertRule(g),await y(),g.id},[n,l,u,y]),W=a.useCallback(async r=>{n&&(await n.timetracking.deleteRule(r),await y())},[n,y]),L=a.useCallback(async r=>{if(!n||!l||!u)return null;const m=j(),g={id:O(),workspaceId:u,ownerId:l,name:r.name??"New Project",color:r.color??"#60A5FA",clientName:r.clientName??"",budgetHours:r.budgetHours??null,linkedTaskProjectId:r.linkedTaskProjectId??null,createdAt:m,updatedAt:m,deletedAt:null};return await n.timetracking.upsertProject(g),await y(),g.id},[n,l,u,y]),F=a.useCallback(async(r,m)=>{if(!n)return;const g=q.find(f=>f.id===r);if(!g)return;const T={...g,...m,updatedAt:j()};await n.timetracking.upsertProject(T),await y()},[n,q,y]),E=a.useCallback(async r=>{n&&(await n.timetracking.deleteProject(r),await y())},[n,y]),R=a.useCallback(async(r,m="Focus")=>{if(!n||!l||!u)return null;const g=j(),T={id:O(),workspaceId:u,ownerId:l,startTime:g,endTime:null,targetMinutes:r,categoryId:null,label:m,isActive:!0,createdAt:g,updatedAt:g,deletedAt:null};return await n.timetracking.upsertFocusSession(T),await y(),T.id},[n,l,u,y]),Y=a.useCallback(async r=>{if(!n)return;const m=b.find(T=>T.id===r);if(!m)return;const g={...m,endTime:j(),isActive:!1,updatedAt:j()};await n.timetracking.upsertFocusSession(g),await y()},[n,b,y]),ae=a.useCallback(async()=>{!n||!u||(await n.timetracking.startTracking(u),I(!0))},[n,u]),J=a.useCallback(async()=>{n&&(await n.timetracking.stopTracking(),I(!1),await y())},[n,y]),M=a.useMemo(()=>v.filter(r=>!r.deletedAt),[v]),K=a.useMemo(()=>i.filter(r=>!r.deletedAt),[i]),z=a.useMemo(()=>new Map(K.map(r=>[r.id,r])),[K]),ie=a.useMemo(()=>{const r=new Date;return`${r.getFullYear()}-${String(r.getMonth()+1).padStart(2,"0")}-${String(r.getDate()).padStart(2,"0")}`},[]),$=a.useMemo(()=>M.filter(r=>r.startTime.startsWith(ie)).sort((r,m)=>r.startTime.localeCompare(m.startTime)),[M,ie]),U=a.useMemo(()=>$.reduce((r,m)=>r+(m.duration||0),0),[$]),Q=a.useMemo(()=>$.reduce((r,m)=>{const g=m.categoryId?z.get(m.categoryId):null;return g&&g.productivityScore>0?r+(m.duration||0):r},0),[$,z]),oe=a.useMemo(()=>U===0?0:Math.round(Q/U*100),[U,Q]),me=a.useMemo(()=>{const r=new Map;for(const g of M){const T=g.startTime.slice(0,10),f=r.get(T)??[];f.push(g),r.set(T,f)}const m=[];for(const[g,T]of r){const f=T.reduce((N,x)=>N+(x.duration||0),0);let X=0,ue=0,Z=0;const ee=new Map;for(const N of T){const x=N.categoryId?z.get(N.categoryId):null,H=N.duration||0;x?(x.productivityScore>0?X+=H:x.productivityScore<0?ue+=H:Z+=H,ee.set(x.id,(ee.get(x.id)??0)+H)):Z+=H}const ge=g,ce=b.filter(N=>!N.deletedAt&&N.startTime.startsWith(ge));m.push({date:g,totalTrackedSeconds:f,productiveSeconds:X,distractingSeconds:ue,neutralSeconds:Z,focusScore:f>0?Math.round(X/f*100):0,topCategories:[...ee.entries()].sort((N,x)=>x[1]-N[1]).slice(0,5).map(([N,x])=>({categoryId:N,seconds:x})),focusSessionCount:ce.length})}return m.sort((g,T)=>T.date.localeCompare(g.date))},[M,z,b]);return{entries:M,categories:K,rules:p.filter(r=>!r.deletedAt),projects:q.filter(r=>!r.deletedAt),focusSessions:b.filter(r=>!r.deletedAt),isTracking:h,loading:A,createEntry:V,updateEntry:B,deleteEntry:t,createCategory:P,updateCategory:_,deleteCategory:G,createRule:te,deleteRule:W,createProject:L,updateProject:F,deleteProject:E,startFocusSession:R,stopFocusSession:Y,startTracking:ae,stopTracking:J,refreshData:y,dailySummaries:me,todayEntries:$,todayTotalSeconds:U,todayProductiveSeconds:Q,todayFocusScore:oe}}const C=60;function ne({tt:n}){const[o,l]=a.useState(!1),[u,v]=a.useState(""),[w,i]=a.useState(""),[s,p]=a.useState(1),[d,q]=a.useState(0),[c,b]=a.useState(()=>{const t=new Date;return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`}),k=a.useMemo(()=>new Map(n.categories.map(t=>[t.id,t])),[n.categories]),h=a.useMemo(()=>n.entries.filter(t=>t.startTime.startsWith(c)).sort((t,P)=>t.startTime.localeCompare(P.startTime)),[n.entries,c]),I=a.useMemo(()=>{const t=[];return h.forEach((P,_)=>{if(_>0){const E=h[_-1],R=(new Date(P.startTime).getTime()-new Date(E.endTime).getTime())/1e3;if(R>=300){const Y=new Date(E.endTime),J=(Y.getHours()*60+Y.getMinutes())/60*C,M=Math.max(R/3600*C,15);t.push({id:`idle-${E.id}`,isIdle:!0,top:J,height:M,color:"#4B5563",appName:"Break / Idle",duration:R,startTime:E.endTime,endTime:P.startTime,icon:"☕"})}}const G=new Date(P.startTime),W=(G.getHours()*60+G.getMinutes())/60*C,L=Math.max(P.duration/3600*C,15),F=P.categoryId?k.get(P.categoryId):null;t.push({...P,isIdle:!1,top:W,height:L,color:F?.color??"#9CA3AF",catName:F?.name,icon:F?.icon})}),t},[h,k]),A=a.useMemo(()=>h.reduce((t,P)=>t+(P.duration||0),0),[h]),D=a.useCallback(async()=>{const t=s*3600+d*60;if(t<=0)return;const P=new Date,_=new Date(P.getTime()-t*1e3).toISOString();await n.createEntry({startTime:_,endTime:P.toISOString(),duration:t,description:u||"Manual entry",categoryId:w||null,isManual:!0}),l(!1),v(""),p(1),q(0),i("")},[n,u,w,s,d]),y=a.useCallback(t=>{const P=new Date(c+"T12:00:00");P.setDate(P.getDate()+t),b(`${P.getFullYear()}-${String(P.getMonth()+1).padStart(2,"0")}-${String(P.getDate()).padStart(2,"0")}`)},[c]),V=a.useMemo(()=>{const t=new Date;return c===`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`},[c]),B=Array.from({length:24},(t,P)=>P);return e.jsxs("div",{className:"tt-timeline-v2",children:[e.jsxs("div",{className:"tt-timeline-header",children:[e.jsxs("div",{className:"tt-date-picker",children:[e.jsx("button",{className:"tt-icon-btn",onClick:()=>y(-1),children:"◀"}),e.jsx("button",{className:"tt-date-display",onClick:()=>{const t=new Date;b(`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`)},children:V?"Today":new Date(c+"T12:00:00").toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"})}),e.jsx("button",{className:"tt-icon-btn",onClick:()=>y(1),children:"▶"})]}),e.jsxs("div",{className:"tt-timeline-actions",children:[e.jsxs("span",{className:"tt-timeline-total",children:[S(A)," tracked"]}),e.jsx("button",{className:"tt-btn-add-sm",onClick:()=>l(!0),children:"+ Add Time"})]})]}),e.jsx("div",{className:"tt-schedule-container",children:e.jsxs("div",{className:"tt-schedule-grid",style:{height:24*C},children:[B.map(t=>e.jsxs("div",{className:"tt-hour-row",style:{top:t*C},children:[e.jsx("div",{className:"tt-hour-label",children:t===0?"12 AM":t<12?`${t} AM`:t===12?"12 PM":`${t-12} PM`}),e.jsx("div",{className:"tt-hour-line"})]},t)),e.jsx("div",{className:"tt-blocks-layer",children:I.map(t=>e.jsxs("div",{className:`tt-time-block ${t.isIdle?"tt-block-idle":""}`,style:{top:t.top,height:t.height,background:`${t.color}1A`,borderLeftColor:t.color},children:[e.jsxs("div",{className:"tt-block-content",children:[e.jsx("div",{className:"tt-block-title",children:(t.appName??t.description)||"Untitled"}),t.height>=30&&e.jsxs("div",{className:"tt-block-meta",children:[t.icon&&e.jsx("span",{className:"tt-block-icon",children:t.icon}),e.jsx("span",{className:"tt-block-time",children:S(t.duration)})]})]}),e.jsx("div",{className:"tt-block-hover",children:e.jsxs("div",{className:"tt-block-tooltip",children:[e.jsxs("div",{className:"tt-tt-header",children:[e.jsx("strong",{children:t.appName??"Manual"}),e.jsx("span",{className:"tt-tt-dur",children:S(t.duration)})]}),t.windowTitle&&e.jsx("div",{className:"tt-tt-window",children:t.windowTitle}),e.jsxs("div",{className:"tt-tt-time",children:[re(t.startTime)," - ",re(t.endTime)]}),t.catName&&e.jsxs("div",{className:"tt-tt-cat",children:[e.jsx("span",{className:"tt-tt-dot",style:{background:t.color}}),t.catName]})]})})]},t.id))}),V&&e.jsx("div",{className:"tt-current-time-line",style:{top:(new Date().getHours()+new Date().getMinutes()/60)*C},children:e.jsx("div",{className:"tt-current-time-dot"})})]})}),o&&e.jsx("div",{className:"tt-modal-overlay",onClick:()=>l(!1),children:e.jsxs("div",{className:"tt-modal",onClick:t=>t.stopPropagation(),children:[e.jsx("h3",{children:"Add Manual Time"}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"What were you doing?"}),e.jsx("input",{className:"tt-input",placeholder:"Description...",value:u,onChange:t=>v(t.target.value),autoFocus:!0})]}),e.jsxs("div",{className:"tt-form-row",children:[e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Hours"}),e.jsx("input",{className:"tt-input",type:"number",min:0,max:23,value:s,onChange:t=>p(parseInt(t.target.value)||0)})]}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Minutes"}),e.jsx("input",{className:"tt-input",type:"number",min:0,max:59,value:d,onChange:t=>q(parseInt(t.target.value)||0)})]})]}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Category"}),e.jsxs("select",{className:"tt-input",value:w,onChange:t=>i(t.target.value),children:[e.jsx("option",{value:"",children:"None"}),n.categories.map(t=>e.jsxs("option",{value:t.id,children:[t.icon," ",t.name]},t.id))]})]}),e.jsxs("div",{className:"tt-form-actions",children:[e.jsx("button",{className:"tt-btn-cancel",onClick:()=>l(!1),children:"Cancel"}),e.jsx("button",{className:"tt-btn-primary",onClick:D,children:"Save"})]})]})})]})}ne.__docgenInfo={description:"",methods:[],displayName:"TimelineView",props:{tt:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"duration",value:{name:"number",required:!0}},{key:"appName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"windowTitle",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"url",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"projectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"isManual",value:{name:"boolean",required:!0}},{key:"isMeeting",value:{name:"boolean",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TimeEntry[]",required:!0}},{key:"todayTotalSeconds",value:{name:"number",required:!0}},{key:"todayProductiveSeconds",value:{name:"number",required:!0}},{key:"todayFocusScore",value:{name:"number",required:!0}}]}},description:""}}};function se({tt:n}){const[o,l]=a.useState(!1),[u,v]=a.useState(""),[w,i]=a.useState("#60A5FA"),[s,p]=a.useState(""),[d,q]=a.useState(""),c=a.useMemo(()=>{const k=new Map;for(const h of n.entries)h.projectId&&k.set(h.projectId,(k.get(h.projectId)??0)+(h.duration||0));return k},[n.entries]),b=a.useCallback(async()=>{u.trim()&&(await n.createProject({name:u,color:w,clientName:s,budgetHours:d?parseFloat(d):null}),l(!1),v(""),i("#60A5FA"),p(""),q(""))},[n,u,w,s,d]);return e.jsxs("div",{className:"tt-projects",children:[e.jsxs("div",{className:"tt-section-header",children:[e.jsx("h3",{className:"tt-section-title",children:"Projects"}),e.jsx("button",{className:"tt-btn-add-sm",onClick:()=>l(!0),children:"+ Add"})]}),n.projects.length===0?e.jsxs("div",{className:"tt-empty-categories",children:[e.jsx("span",{className:"tt-empty-icon",children:"📁"}),e.jsx("p",{children:"No projects yet. Create a project to allocate time to specific clients or initiatives."}),e.jsx("button",{className:"tt-btn-add",onClick:()=>l(!0),children:"+ Create Project"})]}):e.jsx("div",{className:"tt-project-grid",children:n.projects.map(k=>{const h=c.get(k.id)??0,I=h/3600,A=k.budgetHours?Math.min(100,Math.round(I/k.budgetHours*100)):null;return e.jsxs("div",{className:"tt-project-card",children:[e.jsxs("div",{className:"tt-project-card-header",children:[e.jsxs("div",{className:"tt-project-info",children:[e.jsx("span",{className:"tt-project-dot-lg",style:{background:k.color}}),e.jsxs("div",{children:[e.jsx("h4",{className:"tt-project-card-name",children:k.name}),k.clientName&&e.jsx("span",{className:"tt-project-client",children:k.clientName})]})]}),e.jsx("button",{className:"tt-btn-delete-sm",onClick:()=>n.deleteProject(k.id),children:"×"})]}),e.jsxs("div",{className:"tt-project-stats",children:[e.jsx("span",{className:"tt-project-hours",children:S(h)}),k.budgetHours&&e.jsxs("span",{className:"tt-project-budget",children:["of ",k.budgetHours,"h budget"]})]}),A!==null&&e.jsx("div",{className:"tt-budget-bar-track",children:e.jsx("div",{className:`tt-budget-bar-fill ${A>=90?"tt-budget-danger":A>=70?"tt-budget-warn":""}`,style:{width:`${A}%`,background:k.color}})})]},k.id)})}),o&&e.jsx("div",{className:"tt-modal-overlay",onClick:()=>l(!1),children:e.jsxs("div",{className:"tt-modal",onClick:k=>k.stopPropagation(),children:[e.jsx("h3",{children:"New Project"}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Name"}),e.jsx("input",{className:"tt-input",value:u,onChange:k=>v(k.target.value),placeholder:"e.g. Client Website",autoFocus:!0})]}),e.jsxs("div",{className:"tt-form-row",children:[e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Color"}),e.jsx("input",{className:"tt-input",type:"color",value:w,onChange:k=>i(k.target.value)})]}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Client Name"}),e.jsx("input",{className:"tt-input",value:s,onChange:k=>p(k.target.value),placeholder:"Optional"})]})]}),e.jsxs("div",{className:"tt-form-group",children:[e.jsx("label",{children:"Budget (hours)"}),e.jsx("input",{className:"tt-input",type:"number",value:d,onChange:k=>q(k.target.value),placeholder:"Optional",min:0})]}),e.jsxs("div",{className:"tt-form-actions",children:[e.jsx("button",{className:"tt-btn-cancel",onClick:()=>l(!1),children:"Cancel"}),e.jsx("button",{className:"tt-btn-primary",onClick:b,children:"Create"})]})]})})]})}se.__docgenInfo={description:"",methods:[],displayName:"ProjectsView",props:{tt:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"duration",value:{name:"number",required:!0}},{key:"appName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"windowTitle",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"url",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"projectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"isManual",value:{name:"boolean",required:!0}},{key:"isMeeting",value:{name:"boolean",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TimeEntry[]",required:!0}},{key:"todayTotalSeconds",value:{name:"number",required:!0}},{key:"todayProductiveSeconds",value:{name:"number",required:!0}},{key:"todayFocusScore",value:{name:"number",required:!0}}]}},description:""}}};function le({tt:n}){const[o,l]=a.useState("week"),u=a.useMemo(()=>new Map(n.categories.map(d=>[d.id,d])),[n.categories]),v=a.useMemo(()=>{const d=o==="week"?7:30,q=[];for(let c=d-1;c>=0;c--){const b=new Date;b.setDate(b.getDate()-c),q.push(`${b.getFullYear()}-${String(b.getMonth()+1).padStart(2,"0")}-${String(b.getDate()).padStart(2,"0")}`)}return q},[o]),w=a.useMemo(()=>{const d=n.entries.filter(I=>{const A=I.startTime.slice(0,10);return v.includes(A)}),q=d.reduce((I,A)=>I+(A.duration||0),0);let c=0,b=0;for(const I of d){const A=I.categoryId?u.get(I.categoryId):null;A&&A.productivityScore>0?c+=I.duration||0:A&&A.productivityScore<0&&(b+=I.duration||0)}const k=q/v.length,h=n.focusSessions.filter(I=>{const A=I.startTime.slice(0,10);return v.includes(A)});return{totalSeconds:q,productiveSeconds:c,distractingSeconds:b,avgDaily:k,focusSessionCount:h.length}},[n.entries,n.focusSessions,v,u]),i=a.useMemo(()=>{const d=new Map,q=n.entries.filter(c=>v.includes(c.startTime.slice(0,10)));for(const c of q){const b=c.categoryId??"__uncategorized__";d.set(b,(d.get(b)??0)+(c.duration||0))}return[...d.entries()].sort((c,b)=>b[1]-c[1]).map(([c,b])=>({name:c==="__uncategorized__"?"Uncategorized":u.get(c)?.name??"Unknown",color:c==="__uncategorized__"?"#666":u.get(c)?.color??"#888",icon:c==="__uncategorized__"?"❓":u.get(c)?.icon??"",seconds:b}))},[n.entries,v,u]),s=a.useMemo(()=>v.map(d=>{const q=n.dailySummaries.find(c=>c.date===d);return{date:d,total:q?.totalTrackedSeconds??0}}),[v,n.dailySummaries]),p=a.useMemo(()=>Math.max(...s.map(d=>d.total),1),[s]);return e.jsxs("div",{className:"tt-reports",children:[e.jsxs("div",{className:"tt-report-range",children:[e.jsx("button",{className:`tt-range-btn ${o==="week"?"tt-range-active":""}`,onClick:()=>l("week"),children:"This Week"}),e.jsx("button",{className:`tt-range-btn ${o==="month"?"tt-range-active":""}`,onClick:()=>l("month"),children:"This Month"})]}),e.jsxs("div",{className:"tt-report-cards",children:[e.jsxs("div",{className:"tt-report-card",children:[e.jsx("span",{className:"tt-report-card-value",children:S(w.totalSeconds)}),e.jsx("span",{className:"tt-report-card-label",children:"Total Tracked"})]}),e.jsxs("div",{className:"tt-report-card tt-stat-productive",children:[e.jsx("span",{className:"tt-report-card-value",children:S(w.productiveSeconds)}),e.jsx("span",{className:"tt-report-card-label",children:"Productive"})]}),e.jsxs("div",{className:"tt-report-card tt-stat-distracting",children:[e.jsx("span",{className:"tt-report-card-value",children:S(w.distractingSeconds)}),e.jsx("span",{className:"tt-report-card-label",children:"Distracting"})]}),e.jsxs("div",{className:"tt-report-card",children:[e.jsx("span",{className:"tt-report-card-value",children:S(w.avgDaily)}),e.jsx("span",{className:"tt-report-card-label",children:"Daily Average"})]}),e.jsxs("div",{className:"tt-report-card",children:[e.jsx("span",{className:"tt-report-card-value",children:w.focusSessionCount}),e.jsx("span",{className:"tt-report-card-label",children:"Focus Sessions"})]})]}),e.jsxs("div",{className:"tt-report-section",children:[e.jsx("h3",{className:"tt-section-title",children:"Category Breakdown"}),e.jsxs("table",{className:"tt-report-table",children:[e.jsx("thead",{children:e.jsxs("tr",{children:[e.jsx("th",{children:"Category"}),e.jsx("th",{children:"Time"}),e.jsx("th",{children:"Share"})]})}),e.jsx("tbody",{children:i.map(d=>e.jsxs("tr",{children:[e.jsx("td",{children:e.jsxs("span",{className:"tt-report-cat",children:[e.jsx("span",{className:"tt-report-cat-dot",style:{background:d.color}}),d.icon," ",d.name]})}),e.jsx("td",{children:S(d.seconds)}),e.jsxs("td",{children:[w.totalSeconds>0?Math.round(d.seconds/w.totalSeconds*100):0,"%"]})]},d.name))})]})]}),e.jsxs("div",{className:"tt-report-section",children:[e.jsx("h3",{className:"tt-section-title",children:"Daily Activity"}),e.jsx("div",{className:"tt-heatmap",children:s.map(d=>{const q=d.total/p;return e.jsxs("div",{className:"tt-heatmap-cell",title:`${d.date}: ${S(d.total)}`,children:[e.jsx("div",{className:"tt-heatmap-fill",style:{opacity:Math.max(.1,q),background:q>.6?"#34D399":q>.3?"#60A5FA":"#94A3B8"}}),e.jsx("span",{className:"tt-heatmap-label",children:new Date(d.date+"T12:00:00").toLocaleDateString([],{day:"numeric"})})]},d.date)})})]})]})}le.__docgenInfo={description:"",methods:[],displayName:"ReportsView",props:{tt:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"duration",value:{name:"number",required:!0}},{key:"appName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"windowTitle",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"url",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"projectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"isManual",value:{name:"boolean",required:!0}},{key:"isMeeting",value:{name:"boolean",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TimeEntry[]",required:!0}},{key:"todayTotalSeconds",value:{name:"number",required:!0}},{key:"todayProductiveSeconds",value:{name:"number",required:!0}},{key:"todayFocusScore",value:{name:"number",required:!0}}]}},description:""}}};function Te(n){const{tt:o}=n;return e.jsxs("div",{className:"tt-left-panel",children:[e.jsxs("div",{className:"tt-summary-card",children:[e.jsxs("div",{className:"tt-summary-header",children:[e.jsx("span",{className:"tt-summary-icon",children:"📊"}),e.jsx("span",{className:"tt-summary-title",children:"Today"})]}),e.jsxs("div",{className:"tt-summary-stats",children:[e.jsxs("div",{className:"tt-stat",children:[e.jsx("span",{className:"tt-stat-value",children:S(o.todayTotalSeconds)}),e.jsx("span",{className:"tt-stat-label",children:"tracked"})]}),e.jsxs("div",{className:"tt-stat",children:[e.jsxs("span",{className:"tt-stat-value",children:[o.todayFocusScore,"%"]}),e.jsx("span",{className:"tt-stat-label",children:"focus score"})]}),e.jsxs("div",{className:"tt-stat",children:[e.jsx("span",{className:"tt-stat-value",children:S(o.todayProductiveSeconds)}),e.jsx("span",{className:"tt-stat-label",children:"productive"})]})]})]}),e.jsx(qe,{tt:o}),e.jsxs("div",{className:"tt-tracking-card",children:[e.jsxs("div",{className:"tt-tracking-header",children:[e.jsx("span",{className:"tt-tracking-icon",children:o.isTracking?"🔴":"⏸️"}),e.jsx("span",{className:"tt-tracking-label",children:o.isTracking?"Tracking Active":"Tracking Paused"})]}),e.jsx("button",{className:`tt-tracking-btn ${o.isTracking?"tt-btn-stop":"tt-btn-start"}`,onClick:()=>o.isTracking?o.stopTracking():o.startTracking(),children:o.isTracking?"Stop Tracking":"Start Tracking"})]}),o.projects.length>0&&e.jsxs("div",{className:"tt-quick-projects",children:[e.jsx("h4",{className:"tt-section-title",children:"Projects"}),o.projects.slice(0,5).map(l=>e.jsxs("div",{className:"tt-project-chip",children:[e.jsx("span",{className:"tt-project-dot",style:{background:l.color}}),e.jsx("span",{className:"tt-project-name",children:l.name})]},l.id))]})]})}function Se(n){const{tt:o}=n,l=a.useMemo(()=>[...o.todayEntries].reverse().slice(0,20),[o.todayEntries]),u=a.useMemo(()=>new Map(o.categories.map(v=>[v.id,v])),[o.categories]);return e.jsxs("div",{className:"tt-right-panel",children:[e.jsx("h4",{className:"tt-section-title",children:"Activity Feed"}),l.length===0?e.jsxs("div",{className:"tt-empty-feed",children:[e.jsx("span",{className:"tt-empty-icon",children:"🌙"}),e.jsx("p",{children:"No activity yet today"}),e.jsx("p",{className:"tt-empty-sub",children:"Start tracking to see your activity here"})]}):e.jsx("div",{className:"tt-feed-list",children:l.map(v=>{const w=v.categoryId?u.get(v.categoryId):null;return e.jsxs("div",{className:"tt-feed-item",children:[e.jsx("div",{className:"tt-feed-dot",style:{background:w?.color??"#555"}}),e.jsxs("div",{className:"tt-feed-content",children:[e.jsx("span",{className:"tt-feed-app",children:v.appName??"Manual"}),e.jsxs("span",{className:"tt-feed-time",children:[re(v.startTime)," – ",S(v.duration)]})]})]},v.id)})})]})}function fe(){const{runtime:n,userId:o}=ve(),{selectedWorkspaceId:l}=pe(),[u,v]=a.useState("timeline"),w=Ie(n,{userId:o,workspaceId:l}),i=()=>{switch(u){case"timeline":return e.jsx(ne,{tt:w});case"dashboard":return e.jsx(de,{tt:w});case"categories":return e.jsx(we,{tt:w});case"projects":return e.jsx(se,{tt:w});case"reports":return e.jsx(le,{tt:w});default:return e.jsx(ne,{tt:w})}};return e.jsx(ye,{feature:"timetracking",left:e.jsx(Te,{tt:w}),center:e.jsxs("div",{className:"tt-center",children:[e.jsx(ke,{view:u,onViewChange:v}),e.jsx("div",{className:"tt-view-container",children:w.loading?e.jsxs("div",{className:"tt-loading",children:[e.jsx("div",{className:"tt-spinner"}),e.jsx("p",{children:"Loading time tracking data..."})]}):i()})]}),right:e.jsx(Se,{tt:w})})}function S(n){if(n<=0)return"0m";const o=Math.floor(n/3600),l=Math.floor(n%3600/60);return o>0?`${o}h ${l}m`:`${l}m`}function re(n){try{return new Date(n).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}catch{return""}}fe.__docgenInfo={description:"",methods:[],displayName:"TimetrackingWorkspace"};function de({tt:n}){const o=a.useMemo(()=>new Map(n.categories.map(i=>[i.id,i])),[n.categories]),l=a.useMemo(()=>{const i=new Map;for(const s of n.todayEntries){const p=s.categoryId??"__uncategorized__";i.set(p,(i.get(p)??0)+(s.duration||0))}return[...i.entries()].sort((s,p)=>p[1]-s[1]).map(([s,p])=>({id:s,name:s==="__uncategorized__"?"Uncategorized":o.get(s)?.name??"Unknown",color:s==="__uncategorized__"?"#666":o.get(s)?.color??"#888",icon:s==="__uncategorized__"?"❓":o.get(s)?.icon??"",seconds:p,pct:n.todayTotalSeconds>0?Math.round(p/n.todayTotalSeconds*100):0}))},[n.todayEntries,n.todayTotalSeconds,o]),u=a.useMemo(()=>{const i=new Map;for(const s of n.todayEntries){const p=s.appName??"Unknown";i.set(p,(i.get(p)??0)+(s.duration||0))}return[...i.entries()].sort((s,p)=>p[1]-s[1]).slice(0,8).map(([s,p])=>({name:s,seconds:p}))},[n.todayEntries]),v=a.useMemo(()=>{const i=[];for(let s=6;s>=0;s--){const p=new Date;p.setDate(p.getDate()-s);const d=`${p.getFullYear()}-${String(p.getMonth()+1).padStart(2,"0")}-${String(p.getDate()).padStart(2,"0")}`,q=n.dailySummaries.find(c=>c.date===d);i.push({date:d,total:q?.totalTrackedSeconds??0,productive:q?.productiveSeconds??0,score:q?.focusScore??0})}return i},[n.dailySummaries]),w=a.useMemo(()=>Math.max(...v.map(i=>i.total),1),[v]);return e.jsxs("div",{className:"tt-dashboard",children:[e.jsxs("div",{className:"tt-dash-hero",children:[e.jsxs("div",{className:"tt-focus-ring-wrapper",children:[e.jsxs("svg",{className:"tt-focus-ring",viewBox:"0 0 120 120",children:[e.jsx("circle",{className:"tt-ring-bg",cx:"60",cy:"60",r:"52"}),e.jsx("circle",{className:"tt-ring-fill",cx:"60",cy:"60",r:"52",strokeDasharray:`${n.todayFocusScore/100*327} 327`,style:{stroke:n.todayFocusScore>=70?"#34D399":n.todayFocusScore>=40?"#F59E0B":"#EF4444",filter:`drop-shadow(0 0 8px ${n.todayFocusScore>=70?"rgba(52,211,153,0.5)":n.todayFocusScore>=40?"rgba(245,158,11,0.5)":"rgba(239,68,68,0.5)"})`}})]}),e.jsxs("div",{className:"tt-focus-ring-value",children:[e.jsx("span",{className:"tt-focus-number",children:n.todayFocusScore}),e.jsx("span",{className:"tt-focus-unit",children:"%"})]})]}),e.jsx("div",{className:"tt-focus-label",children:"Focus Score"})]}),e.jsxs("div",{className:"tt-dash-stats-row",children:[e.jsxs("div",{className:"tt-dash-stat-card",children:[e.jsx("span",{className:"tt-dash-stat-icon",children:"⏱️"}),e.jsx("span",{className:"tt-dash-stat-value",children:S(n.todayTotalSeconds)}),e.jsx("span",{className:"tt-dash-stat-label",children:"Total Tracked"})]}),e.jsxs("div",{className:"tt-dash-stat-card tt-stat-productive",children:[e.jsx("span",{className:"tt-dash-stat-icon",children:"🎯"}),e.jsx("span",{className:"tt-dash-stat-value",children:S(n.todayProductiveSeconds)}),e.jsx("span",{className:"tt-dash-stat-label",children:"Productive"})]}),e.jsxs("div",{className:"tt-dash-stat-card tt-stat-distracting",children:[e.jsx("span",{className:"tt-dash-stat-icon",children:"📱"}),e.jsx("span",{className:"tt-dash-stat-value",children:S(n.todayEntries.reduce((i,s)=>{const p=s.categoryId?o.get(s.categoryId):null;return i+(p&&p.productivityScore<0&&s.duration||0)},0))}),e.jsx("span",{className:"tt-dash-stat-label",children:"Distracting"})]}),e.jsxs("div",{className:"tt-dash-stat-card",children:[e.jsx("span",{className:"tt-dash-stat-icon",children:"🧘"}),e.jsx("span",{className:"tt-dash-stat-value",children:n.focusSessions.filter(i=>{const s=new Date,p=`${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,"0")}-${String(s.getDate()).padStart(2,"0")}`;return i.startTime.startsWith(p)}).length}),e.jsx("span",{className:"tt-dash-stat-label",children:"Focus Sessions"})]})]}),e.jsxs("div",{className:"tt-dash-section",children:[e.jsx("h3",{className:"tt-dash-section-title",children:"Time by Category"}),l.length===0?e.jsx("p",{className:"tt-dash-empty",children:"No categorized time yet"}):e.jsx("div",{className:"tt-category-bars",children:l.map(i=>e.jsxs("div",{className:"tt-cat-bar-row",children:[e.jsxs("div",{className:"tt-cat-bar-label",children:[e.jsxs("span",{children:[i.icon," ",i.name]}),e.jsxs("span",{className:"tt-cat-bar-time",children:[S(i.seconds)," (",i.pct,"%)"]})]}),e.jsx("div",{className:"tt-cat-bar-track",children:e.jsx("div",{className:"tt-cat-bar-fill",style:{width:`${i.pct}%`,background:i.color}})})]},i.id))})]}),e.jsxs("div",{className:"tt-dash-section",children:[e.jsx("h3",{className:"tt-dash-section-title",children:"Top Apps"}),u.length===0?e.jsx("p",{className:"tt-dash-empty",children:"No app data yet"}):e.jsx("div",{className:"tt-top-apps",children:u.map((i,s)=>e.jsxs("div",{className:"tt-app-row",children:[e.jsx("span",{className:"tt-app-rank",children:s+1}),e.jsx("span",{className:"tt-app-name",children:i.name}),e.jsx("div",{className:"tt-app-bar-track",children:e.jsx("div",{className:"tt-app-bar-fill",style:{width:`${Math.round(i.seconds/(u[0]?.seconds||1)*100)}%`}})}),e.jsx("span",{className:"tt-app-time",children:S(i.seconds)})]},i.name))})]}),e.jsxs("div",{className:"tt-dash-section",children:[e.jsx("h3",{className:"tt-dash-section-title",children:"Weekly Trend"}),e.jsx("div",{className:"tt-weekly-chart",children:v.map(i=>e.jsxs("div",{className:"tt-weekly-bar-col",children:[e.jsxs("div",{className:"tt-weekly-bar-wrapper",children:[e.jsx("div",{className:"tt-weekly-bar tt-bar-total",style:{height:`${i.total/w*100}%`}}),e.jsx("div",{className:"tt-weekly-bar tt-bar-productive",style:{height:`${i.productive/w*100}%`}})]}),e.jsx("span",{className:"tt-weekly-label",children:new Date(i.date+"T12:00:00").toLocaleDateString([],{weekday:"narrow"})})]},i.date))})]})]})}de.__docgenInfo={description:"",methods:[],displayName:"DashboardView",props:{tt:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"duration",value:{name:"number",required:!0}},{key:"appName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"windowTitle",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"url",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"categoryId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"projectId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"isManual",value:{name:"boolean",required:!0}},{key:"isMeeting",value:{name:"boolean",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TimeEntry[]",required:!0}},{key:"todayTotalSeconds",value:{name:"number",required:!0}},{key:"todayProductiveSeconds",value:{name:"number",required:!0}},{key:"todayFocusScore",value:{name:"number",required:!0}}]}},description:""}}};export{de as D,se as P,le as R,ne as T,fe as a};
