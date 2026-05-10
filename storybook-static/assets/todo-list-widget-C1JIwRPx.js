import{j as r}from"./jsx-runtime-u17CrQMm.js";import{a as g}from"./widget-shell-D7048ePO.js";function c(){return typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}function v(i){return Array.isArray(i)?i.filter(n=>n&&typeof n.id=="string").map(n=>({id:n.id,text:typeof n.text=="string"?n.text:"",done:!!n.done})):[]}function b({config:i,isLocked:n,onUpdateConfig:s}){const u=(i.todoListTitle??"").trim()||"To-do List",a=v(i.todoListItems),l=e=>s({todoListItems:e}),d=e=>{n&&l(a.map(t=>t.id===e?{...t,done:!t.done}:t))},m=()=>{n||l([...a,{id:c(),text:"New item",done:!1}])},y=e=>{n||l(a.filter(t=>t.id!==e))},p=(e,t)=>{n||l(a.map(o=>o.id===e?{...o,text:t}:o))};return r.jsx(g,{config:i,title:u,children:n?r.jsxs("div",{className:"flex h-full min-h-0 flex-col px-3 py-3",children:[r.jsx("p",{className:"mb-2 truncate text-[11px] text-[#8f8f8f]",children:u}),r.jsxs("div",{className:"min-h-0 flex-1 overflow-y-auto pr-1",children:[a.length===0?r.jsx("p",{className:"text-[12px] text-[#7f7f7f]",children:"No items."}):null,a.map(e=>r.jsxs("button",{type:"button",className:"mb-0.5 flex w-full items-center gap-1 rounded-md px-0.5 py-0.5 text-left",onClick:()=>d(e.id),children:[r.jsx("span",{className:`grid h-4 w-4 place-items-center rounded-sm border text-[10px] ${e.done?"border-[#4a4a4a] bg-[#1b1b1b] text-[#d0d0d0]":"border-[#3a3a3a] text-[#777777]"}`,children:e.done?"✓":""}),r.jsx("span",{className:`min-w-0 flex-1 truncate text-[12px] ${e.done?"text-[#B2B2B2]/50 line-through":"text-[#d8d8d8]"}`,children:e.text||"Untitled item"})]},e.id))]})]}):r.jsxs("div",{className:"flex h-full min-h-0 flex-col gap-2 px-3 py-3",children:[r.jsx("input",{type:"text",value:i.todoListTitle??"",onChange:e=>s({todoListTitle:e.target.value}),placeholder:"Title",className:"w-full rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#cfcfcf] outline-none"}),r.jsxs("div",{className:"min-h-0 flex-1 overflow-y-auto pr-1",children:[a.length===0?r.jsx("p",{className:"text-[11px] text-[#7f7f7f]",children:"No items yet."}):null,a.map(e=>r.jsxs("div",{className:"mb-2 flex items-center gap-2",children:[r.jsx("input",{type:"text",value:e.text,onChange:t=>p(e.id,t.target.value),className:"min-w-0 flex-1 rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"}),r.jsx("button",{type:"button",className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] hover:bg-[#1b1b1b]",onClick:()=>y(e.id),children:"Remove"})]},e.id))]}),r.jsx("button",{type:"button",className:"rounded border border-[#2b2b2b] bg-[#151515] px-2.5 py-1.5 text-[11px] text-[#d8d8d8] hover:bg-[#1b1b1b]",onClick:m,children:"+ Add item"})]})})}b.__docgenInfo={description:"",methods:[],displayName:"TodoListWidget",props:{config:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"noteId",value:{name:"string",required:!1}},{key:"projectIds",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!1}},{key:"timezones",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!1}},{key:"weatherCity",value:{name:"string",required:!1}},{key:"weatherLat",value:{name:"number",required:!1}},{key:"weatherLon",value:{name:"number",required:!1}},{key:"stocks",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  symbol: string;
  name: string;
}`,signature:{properties:[{key:"symbol",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}}]}}],raw:"StockEntry[]",required:!1}},{key:"cryptos",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  symbol: string;
  name: string;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"symbol",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}}]}}],raw:"CryptoEntry[]",required:!1}},{key:"pomodoroWorkMinutes",value:{name:"number",required:!1}},{key:"pomodoroBreakMinutes",value:{name:"number",required:!1}},{key:"hydrationGoalMl",value:{name:"number",required:!1}},{key:"hydrationConsumedMl",value:{name:"number",required:!1}},{key:"hydrationLastDate",value:{name:"string",required:!1}},{key:"countdownTitle",value:{name:"string",required:!1}},{key:"countdownTargetIso",value:{name:"string",required:!1}},{key:"countdownActive",value:{name:"boolean",required:!1}},{key:"todoListTitle",value:{name:"string",required:!1}},{key:"todoListItems",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  text: string;
  done: boolean;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"text",value:{name:"string",required:!0}},{key:"done",value:{name:"boolean",required:!0}}]}}],raw:"TodoListItem[]",required:!1}},{key:"jobApplications",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  applicationDate: string;
  offerLink: string;
  positionName: string;
  companyName: string;
  salaryAmount: string;
  salaryUnit: JobSalaryUnit;
  stage: JobApplicationStage;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"applicationDate",value:{name:"string",required:!0}},{key:"offerLink",value:{name:"string",required:!0}},{key:"positionName",value:{name:"string",required:!0}},{key:"companyName",value:{name:"string",required:!0}},{key:"salaryAmount",value:{name:"string",required:!0}},{key:"salaryUnit",value:{name:"union",raw:'"hour" | "day" | "week" | "month" | "year"',elements:[{name:"literal",value:'"hour"'},{name:"literal",value:'"day"'},{name:"literal",value:'"week"'},{name:"literal",value:'"month"'},{name:"literal",value:'"year"'}],required:!0}},{key:"stage",value:{name:"union",raw:`| "applied"
| "rejected"
| "replied"
| "preinterview"
| "interview"
| "technical"
| "behavioral"
| "staff"
| "decision"
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}},description:""},isLocked:{required:!0,tsType:{name:"boolean"},description:""},onUpdateConfig:{required:!0,tsType:{name:"signature",type:"function",raw:"(patch: Partial<WidgetConfig>) => void",signature:{arguments:[{type:{name:"Partial",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"noteId",value:{name:"string",required:!1}},{key:"projectIds",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!1}},{key:"timezones",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!1}},{key:"weatherCity",value:{name:"string",required:!1}},{key:"weatherLat",value:{name:"number",required:!1}},{key:"weatherLon",value:{name:"number",required:!1}},{key:"stocks",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  symbol: string;
  name: string;
}`,signature:{properties:[{key:"symbol",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}}]}}],raw:"StockEntry[]",required:!1}},{key:"cryptos",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  symbol: string;
  name: string;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"symbol",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}}]}}],raw:"CryptoEntry[]",required:!1}},{key:"pomodoroWorkMinutes",value:{name:"number",required:!1}},{key:"pomodoroBreakMinutes",value:{name:"number",required:!1}},{key:"hydrationGoalMl",value:{name:"number",required:!1}},{key:"hydrationConsumedMl",value:{name:"number",required:!1}},{key:"hydrationLastDate",value:{name:"string",required:!1}},{key:"countdownTitle",value:{name:"string",required:!1}},{key:"countdownTargetIso",value:{name:"string",required:!1}},{key:"countdownActive",value:{name:"boolean",required:!1}},{key:"todoListTitle",value:{name:"string",required:!1}},{key:"todoListItems",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  text: string;
  done: boolean;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"text",value:{name:"string",required:!0}},{key:"done",value:{name:"boolean",required:!0}}]}}],raw:"TodoListItem[]",required:!1}},{key:"jobApplications",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  applicationDate: string;
  offerLink: string;
  positionName: string;
  companyName: string;
  salaryAmount: string;
  salaryUnit: JobSalaryUnit;
  stage: JobApplicationStage;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"applicationDate",value:{name:"string",required:!0}},{key:"offerLink",value:{name:"string",required:!0}},{key:"positionName",value:{name:"string",required:!0}},{key:"companyName",value:{name:"string",required:!0}},{key:"salaryAmount",value:{name:"string",required:!0}},{key:"salaryUnit",value:{name:"union",raw:'"hour" | "day" | "week" | "month" | "year"',elements:[{name:"literal",value:'"hour"'},{name:"literal",value:'"day"'},{name:"literal",value:'"week"'},{name:"literal",value:'"month"'},{name:"literal",value:'"year"'}],required:!0}},{key:"stage",value:{name:"union",raw:`| "applied"
| "rejected"
| "replied"
| "preinterview"
| "interview"
| "technical"
| "behavioral"
| "staff"
| "decision"
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}}],raw:"Partial<WidgetConfig>"},name:"patch"}],return:{name:"void"}}},description:""}}};export{b as T};
