import{j as e}from"./jsx-runtime-u17CrQMm.js";import{r as i}from"./index-B3d2A58Q.js";import{c}from"./createLucideIcon-CVEjH9DW.js";import{X as y}from"./x-mvR0woP4.js";const p=[["circle",{cx:"12",cy:"9",r:"1",key:"124mty"}],["circle",{cx:"19",cy:"9",r:"1",key:"1ruzo2"}],["circle",{cx:"5",cy:"9",r:"1",key:"1a8b28"}],["circle",{cx:"12",cy:"15",r:"1",key:"1e56xg"}],["circle",{cx:"19",cy:"15",r:"1",key:"1a92ep"}],["circle",{cx:"5",cy:"15",r:"1",key:"5r1jwy"}]],g=c("grip-horizontal",p),s=i.createContext(null);function v({value:a,children:n}){return e.jsx(s.Provider,{value:a,children:n})}function k({config:a,title:n,controls:o,className:l="flex h-full flex-col bg-[#111111]",children:u}){const r=i.useContext(s),d=r?!r.isLocked:!0,m=!(r&&!r.isLocked);return e.jsxs("div",{className:`${l} min-h-0`,children:[d?e.jsx("div",{className:"border-b border-[#212121] px-3 py-2",children:e.jsxs("div",{className:"flex items-center justify-between gap-2",children:[m?e.jsx("p",{className:"text-[12px] font-semibold text-[#efefef]",children:n}):e.jsx("span",{}),e.jsxs("div",{className:"flex min-w-0 items-center justify-end gap-2",children:[o,r&&!r.isLocked?e.jsxs("div",{className:"flex items-center gap-1 rounded-md border border-[#2a2a2a] bg-[#161616] px-1 py-1",children:[e.jsx("button",{type:"button",...r.dragListeners??{},...r.dragAttributes??{},className:"grid h-5 w-5 place-items-center cursor-grab text-[#848484] active:cursor-grabbing hover:text-[#d9d9d9]",title:"Drag widget",children:e.jsx(g,{size:12,strokeWidth:1.9})}),e.jsx("button",{type:"button",className:"grid h-5 w-5 place-items-center text-[#888888] hover:text-[#f1a3a3]",onPointerDown:t=>t.stopPropagation(),onClick:t=>{t.stopPropagation(),r.onRemove()},title:"Remove widget",children:e.jsx(y,{size:12,strokeWidth:1.8})})]}):null]})]})}):null,e.jsx("div",{className:"min-h-0 flex-1",children:u})]})}v.__docgenInfo={description:"",methods:[],displayName:"WidgetShellEditProvider",props:{value:{required:!0,tsType:{name:"signature",type:"object",raw:`{
  isLocked: boolean;
  onRemove: () => void;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
}`,signature:{properties:[{key:"isLocked",value:{name:"boolean",required:!0}},{key:"onRemove",value:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}},required:!0}},{key:"dragAttributes",value:{name:"Record",elements:[{name:"string"},{name:"unknown"}],raw:"Record<string, unknown>",required:!1}},{key:"dragListeners",value:{name:"Record",elements:[{name:"string"},{name:"unknown"}],raw:"Record<string, unknown>",required:!1}}]}},description:""},children:{required:!0,tsType:{name:"ReactNode"},description:""}}};k.__docgenInfo={description:"",methods:[],displayName:"WidgetShell",props:{config:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}},description:""},title:{required:!0,tsType:{name:"string"},description:""},controls:{required:!1,tsType:{name:"ReactNode"},description:""},className:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:'"flex h-full flex-col bg-[#111111]"',computed:!1}},children:{required:!0,tsType:{name:"ReactNode"},description:""}}};export{v as W,k as a};
