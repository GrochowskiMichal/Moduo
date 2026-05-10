import{j as n}from"./jsx-runtime-u17CrQMm.js";import{r as q}from"./index-B3d2A58Q.js";const w=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],h=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function c(t){return String(t).padStart(2,"0")}function b(t,i){return t.getFullYear()===i.getFullYear()&&t.getMonth()===i.getMonth()&&t.getDate()===i.getDate()}function I(t){return b(t,new Date)}function k(t){const i=t.getHours(),u=t.getMinutes(),o=i>=12?"PM":"AM",d=i%12||12;return u===0?`${d} ${o}`:`${d}:${c(u)} ${o}`}function T({events:t,tasks:i,taskStates:u,sources:o,showEvents:d,showTasks:p,onClickEvent:x,onSelectTask:f,onOpenTaskContextMenu:y}){const v=q.useMemo(()=>{const a=new Map,m=r=>`${r.getFullYear()}-${c(r.getMonth()+1)}-${c(r.getDate())}`;if(d&&t.forEach(r=>{const e=m(new Date(r.startTime));a.has(e)||a.set(e,{events:[],tasks:[]}),a.get(e).events.push(r)}),p){const r=new Set(u.filter(e=>e.kind==="done"||e.kind==="canceled").map(e=>e.id));i.filter(e=>!e.deletedAt&&e.dueDate&&!r.has(e.stateId)).forEach(e=>{const l=e.dueDate;a.has(l)||a.set(l,{events:[],tasks:[]}),a.get(l).tasks.push(e)})}return Array.from(a.entries()).sort(([r],[e])=>r.localeCompare(e)).map(([r,e])=>({date:new Date(`${r}T00:00:00`),items:e}))},[t,i,u,d,p]);return v.length?n.jsx("div",{className:"flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-4",children:v.map(({date:a,items:m})=>{const r=I(a);return n.jsxs("div",{children:[n.jsxs("div",{className:`flex items-center gap-2 mb-1.5 ${r?"text-[#d4d4d4]":"text-[#444]"}`,children:[n.jsx("span",{className:"text-[9px] font-bold uppercase tracking-widest",children:w[a.getDay()]}),n.jsxs("span",{className:"text-[11px] font-bold",children:[a.getDate()," ",h[a.getMonth()]]}),r&&n.jsx("span",{className:"text-[9px] font-bold bg-[#2a2a2a] text-[#f1f1f1] px-1.5 py-0.5 rounded-full",children:"Today"})]}),n.jsxs("div",{className:"flex flex-col gap-1",children:[m.events.map(e=>{const l=o.find(s=>s.id===e.calendarId),g=e.color||l?.color||"#5865f2";return n.jsxs("button",{onClick:()=>x(e.id),className:"flex items-center gap-3 px-3 py-2 rounded-xl border border-[#151515] bg-[#0e0e0e] hover:bg-[#131313] hover:border-[#1e1e1e] transition-all text-left w-full",children:[n.jsx("div",{className:"shrink-0 w-0.5 h-8 rounded-full",style:{background:g}}),n.jsxs("div",{children:[n.jsx("div",{className:"text-[11px] font-semibold text-[#ddd]",children:e.title||"Event"}),n.jsxs("div",{className:"text-[9px] text-[#444] mt-0.5",children:[k(new Date(e.startTime))," – ",k(new Date(e.endTime))]})]})]},e.id)}),m.tasks.map(e=>{const l=e.priority===0?"#ff5252":e.priority===1?"#f0a43d":e.priority===2?"#2f8fff":e.priority===3?"#2fbf71":"#616978",g=u.find(s=>s.id===e.stateId);return n.jsxs("button",{onClick:()=>f(e.id),onContextMenu:s=>{y&&(s.preventDefault(),y(e.id,s.clientX,s.clientY))},className:"flex items-center gap-3 px-3 py-2 rounded-xl border border-[#151515] bg-[#0e0e0e] hover:bg-[#131313] hover:border-[#1e1e1e] transition-all text-left w-full",children:[n.jsx("div",{className:"shrink-0 w-4 h-4 rounded-md border grid place-items-center",style:{borderColor:`${l}40`},children:n.jsx("span",{className:"text-[8px]",style:{color:l},children:"✓"})}),n.jsxs("div",{className:"flex-1 min-w-0",children:[n.jsx("div",{className:"text-[11px] font-semibold text-[#ddd] truncate",children:e.title||"Task"}),n.jsx("div",{className:"text-[9px] mt-0.5",style:{color:l},children:["PI","PII","PIII","PIV","Nulla"][e.priority]})]}),g&&n.jsx("span",{className:"text-[9px] text-[#333] shrink-0",children:g.name})]},e.id)})]})]},a.toISOString())})}):n.jsx("div",{className:"flex h-full items-center justify-center text-[12px] text-[#222]",children:"Nothing scheduled."})}T.__docgenInfo={description:"",methods:[],displayName:"ListView",props:{events:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string;
  recurring: boolean;
  recurrenceRule: string | null;
  attendees: CalendarAttendee[];
  reminders: number[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  externalProvider?: CalendarProvider;
  externalId?: string;
  externalICalUid?: string;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"calendarId",value:{name:"string",required:!0}},{key:"title",value:{name:"string",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"location",value:{name:"string",required:!0}},{key:"startTime",value:{name:"string",required:!0}},{key:"endTime",value:{name:"string",required:!0}},{key:"allDay",value:{name:"boolean",required:!0}},{key:"color",value:{name:"string",required:!0}},{key:"recurring",value:{name:"boolean",required:!0}},{key:"recurrenceRule",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"attendees",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  email: string;
  name: string;
  status: "accepted" | "declined" | "tentative" | "pending";
}`,signature:{properties:[{key:"email",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"status",value:{name:"union",raw:'"accepted" | "declined" | "tentative" | "pending"',elements:[{name:"literal",value:'"accepted"'},{name:"literal",value:'"declined"'},{name:"literal",value:'"tentative"'},{name:"literal",value:'"pending"'}],required:!0}}]}}],raw:"CalendarAttendee[]",required:!0}},{key:"reminders",value:{name:"Array",elements:[{name:"number"}],raw:"number[]",required:!0}},{key:"tags",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"externalProvider",value:{name:"union",raw:'"google" | "outlook" | "apple" | "local"',elements:[{name:"literal",value:'"google"'},{name:"literal",value:'"outlook"'},{name:"literal",value:'"apple"'},{name:"literal",value:'"local"'}],required:!1}},{key:"externalId",value:{name:"string",required:!1}},{key:"externalICalUid",value:{name:"string",required:!1}}]}}],raw:"CalendarEvent[]"},description:""},tasks:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  workspaceId: string;
  ownerId: string;
  projectId: string;
  taskCode: string | null;
  parentTaskId: string | null;
  childOfTaskId: string | null;
  blockedByTaskIds: string[];
  duplicateOfTaskId: string | null;
  stateId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  tags: string[];
  priority: TaskPriority;
  dueDate: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"projectId",value:{name:"string",required:!0}},{key:"taskCode",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"parentTaskId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"childOfTaskId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"blockedByTaskIds",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!0}},{key:"duplicateOfTaskId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"stateId",value:{name:"string",required:!0}},{key:"assigneeId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"title",value:{name:"string",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"tags",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!0}},{key:"priority",value:{name:"union",raw:"0 | 1 | 2 | 3 | 4",elements:[{name:"literal",value:"0"},{name:"literal",value:"1"},{name:"literal",value:"2"},{name:"literal",value:"3"},{name:"literal",value:"4"}],required:!0}},{key:"dueDate",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"Task[]"},description:""},taskStates:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  workspaceId: string;
  ownerId: string;
  projectId: string;
  name: string;
  kind: TaskWorkflowKind;
  icon: string | null;
  color: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"projectId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"kind",value:{name:"union",raw:`| "backlog"
| "todo"
| "in_progress"
| "in_review"
| "done"
| "canceled"
| "custom"`,elements:[{name:"literal",value:'"backlog"'},{name:"literal",value:'"todo"'},{name:"literal",value:'"in_progress"'},{name:"literal",value:'"in_review"'},{name:"literal",value:'"done"'},{name:"literal",value:'"canceled"'},{name:"literal",value:'"custom"'}],required:!0}},{key:"icon",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"color",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TaskWorkflowState[]"},description:""},sources:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  accountId: string;
  name: string;
  color: string;
  visible: boolean;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"accountId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"color",value:{name:"string",required:!0}},{key:"visible",value:{name:"boolean",required:!0}}]}}],raw:"CalendarSource[]"},description:""},showEvents:{required:!0,tsType:{name:"boolean"},description:""},showTasks:{required:!0,tsType:{name:"boolean"},description:""},onClickEvent:{required:!0,tsType:{name:"signature",type:"function",raw:"(id: string) => void",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"void"}}},description:""},onSelectTask:{required:!0,tsType:{name:"signature",type:"function",raw:"(id: string) => void",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"void"}}},description:""},onOpenTaskContextMenu:{required:!1,tsType:{name:"signature",type:"function",raw:"(taskId: string, x: number, y: number) => void",signature:{arguments:[{type:{name:"string"},name:"taskId"},{type:{name:"number"},name:"x"},{type:{name:"number"},name:"y"}],return:{name:"void"}}},description:""}}};export{T as L};
