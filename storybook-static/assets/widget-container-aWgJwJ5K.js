import{j as t}from"./jsx-runtime-u17CrQMm.js";import{d as A}from"./core.esm-P1l0hGcK.js";import{r as T}from"./index-B3d2A58Q.js";import{W as M}from"./widget-shell-D7048ePO.js";function E({widget:e,gridSize:r,isLocked:a,onResize:d,onRemove:y,children:p}){const{attributes:v,listeners:c,setNodeRef:g,transform:i,isDragging:o}=A({id:e.id,data:{isWidget:!0,widget:e},disabled:a}),[b,s]=T.useState(!1),k=n=>{if(a)return;n.preventDefault(),n.stopPropagation();const f=n.clientX,q=n.clientY,w=e.w,x=e.h,u=m=>{const j=Math.max(2,w+Math.round((m.clientX-f)/r)),L=Math.max(2,x+Math.round((m.clientY-q)/r));d(e.id,j,L)},l=()=>{document.removeEventListener("mousemove",u),document.removeEventListener("mouseup",l),s(!1)};document.addEventListener("mousemove",u),document.addEventListener("mouseup",l),s(!0)},h={position:"absolute",left:e.x*r,top:e.y*r,width:e.w*r-8,height:e.h*r-8,transform:i?`translate3d(${i.x}px, ${i.y}px, 0)`:void 0,opacity:o?.82:1,zIndex:o||b?30:2,willChange:"transform, left, top"};return t.jsxs("div",{ref:g,style:h,className:"group relative overflow-hidden rounded-2xl border border-[#242424] bg-[#111111]",children:[t.jsx("div",{className:"relative h-full min-h-0 overflow-hidden",onPointerDown:n=>n.stopPropagation(),children:t.jsx(M,{value:{isLocked:a,onRemove:()=>y(e.id),dragAttributes:v,dragListeners:c},children:p})}),a?null:t.jsx("div",{className:"absolute bottom-0 right-0 z-20 h-6 w-6 cursor-se-resize opacity-0 transition-opacity group-hover:opacity-100",onMouseDown:k,children:t.jsx("div",{className:"absolute bottom-[5px] right-[5px] h-2 w-2 border-b-2 border-r-2 border-[#535353]"})})]})}E.__docgenInfo={description:"",methods:[],displayName:"WidgetContainer",props:{widget:{required:!0,tsType:{name:"signature",type:"object",raw:`{
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"type",value:{name:"union",raw:'"notes" | "tasks" | "clock" | "weather" | "stock" | "crypto" | "pomodoro" | "hydration" | "countdown" | "todolist" | "job-tracker"',elements:[{name:"literal",value:'"notes"'},{name:"literal",value:'"tasks"'},{name:"literal",value:'"clock"'},{name:"literal",value:'"weather"'},{name:"literal",value:'"stock"'},{name:"literal",value:'"crypto"'},{name:"literal",value:'"pomodoro"'},{name:"literal",value:'"hydration"'},{name:"literal",value:'"countdown"'},{name:"literal",value:'"todolist"'},{name:"literal",value:'"job-tracker"'}],required:!0}},{key:"x",value:{name:"number",required:!0}},{key:"y",value:{name:"number",required:!0}},{key:"w",value:{name:"number",required:!0}},{key:"h",value:{name:"number",required:!0}},{key:"config",value:{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]},required:!0}}]}},description:""},gridSize:{required:!0,tsType:{name:"number"},description:""},isLocked:{required:!0,tsType:{name:"boolean"},description:""},onResize:{required:!0,tsType:{name:"signature",type:"function",raw:"(id: string, w: number, h: number) => void",signature:{arguments:[{type:{name:"string"},name:"id"},{type:{name:"number"},name:"w"},{type:{name:"number"},name:"h"}],return:{name:"void"}}},description:""},onRemove:{required:!0,tsType:{name:"signature",type:"function",raw:"(id: string) => void",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"void"}}},description:""},children:{required:!0,tsType:{name:"ReactNode"},description:""}}};export{E as W};
