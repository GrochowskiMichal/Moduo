import{j as n}from"./jsx-runtime-u17CrQMm.js";import{r as u}from"./index-B3d2A58Q.js";import{a as N}from"./widget-shell-D7048ePO.js";const S=25,I=5;function v(i,o,l,e){const r=Number(i);return Number.isFinite(r)?Math.min(e,Math.max(l,Math.round(r))):o}function d(i,o,l){return(i==="work"?o:l)*60}function T(i){const o=Math.max(0,i),l=Math.floor(o/60),e=o%60;return`${String(l).padStart(2,"0")}:${String(e).padStart(2,"0")}`}function E({config:i,isLocked:o,onUpdateConfig:l}){const e=v(i.pomodoroWorkMinutes,S,5,90),r=v(i.pomodoroBreakMinutes,I,1,30),[a,k]=u.useState("work"),[s,b]=u.useState(!1),[c,y]=u.useState(null),[p,m]=u.useState(()=>d("work",e,r));u.useEffect(()=>{s||m(d(a,e,r))},[a,e,r,s]),u.useEffect(()=>{if(!s||!c)return;const t=()=>{const w=Math.max(0,Math.ceil((c-Date.now())/1e3));if(w>0){m(w);return}const h=a==="work"?"break":"work",x=d(h,e,r);k(h),m(x),y(Date.now()+x*1e3)};t();const g=window.setInterval(t,250);return()=>window.clearInterval(g)},[s,c,a,e,r]);const f=u.useMemo(()=>d(a,e,r),[a,e,r]),q=Math.min(100,Math.max(0,(f-p)/f*100)),M=()=>{s||(b(!0),y(Date.now()+p*1e3))},j=()=>{if(!s)return;const t=c?Math.max(0,Math.ceil((c-Date.now())/1e3)):p;m(t),b(!1),y(null)},A=()=>{const t=d(a,e,r);b(!1),y(null),m(t)},L=()=>{const t=a==="work"?"break":"work",g=d(t,e,r);k(t),m(g),y(s?Date.now()+g*1e3:null)};return n.jsx(N,{config:i,title:"Pomodoro",controls:o?null:n.jsxs("div",{className:"flex items-center gap-1.5 text-[11px] text-[#9a9a9a]",children:[n.jsx("input",{type:"number",min:5,max:90,step:1,value:e,onChange:t=>l({pomodoroWorkMinutes:v(Number(t.target.value),e,5,90)}),className:"w-10 rounded border border-[#2b2b2b] bg-[#141414] px-1 py-0.5 text-center text-[11px] text-[#cfcfcf] outline-none"}),n.jsx("span",{children:"work"}),n.jsx("input",{type:"number",min:1,max:30,step:1,value:r,onChange:t=>l({pomodoroBreakMinutes:v(Number(t.target.value),r,1,30)}),className:"w-10 rounded border border-[#2b2b2b] bg-[#141414] px-1 py-0.5 text-center text-[11px] text-[#cfcfcf] outline-none"}),n.jsx("span",{children:"break"})]}),children:n.jsxs("div",{className:"flex flex-1 flex-col items-center justify-center px-3 py-3",children:[n.jsx("p",{className:`text-[11px] uppercase tracking-[0.08em] ${a==="work"?"text-[#f0c77d]":"text-[#9fcdff]"}`,children:a==="work"?"Focus":"Break"}),n.jsx("p",{className:"mt-1 text-[34px] font-semibold leading-none text-[#f1f1f1]",children:T(p)}),n.jsx("div",{className:"mt-3 h-1.5 w-full rounded bg-[#1e1e1e]",children:n.jsx("div",{className:"h-full rounded bg-[#8db7ff] transition-[width] duration-300",style:{width:`${q}%`}})}),n.jsxs("div",{className:"mt-4 flex items-center gap-2",children:[n.jsx("button",{onClick:s?j:M,className:"rounded-md border border-[#2b2b2b] bg-[#151515] px-2.5 py-1 text-[11px] text-[#e3e3e3] hover:bg-[#1a1a1a]",children:s?"Pause":"Start"}),n.jsx("button",{onClick:A,className:"rounded-md border border-[#2b2b2b] bg-[#151515] px-2.5 py-1 text-[11px] text-[#bfbfbf] hover:bg-[#1a1a1a]",children:"Reset"}),n.jsx("button",{onClick:L,className:"rounded-md border border-[#2b2b2b] bg-[#151515] px-2.5 py-1 text-[11px] text-[#bfbfbf] hover:bg-[#1a1a1a]",children:"Skip"})]})]})})}E.__docgenInfo={description:"",methods:[],displayName:"PomodoroWidget",props:{config:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}}],raw:"Partial<WidgetConfig>"},name:"patch"}],return:{name:"void"}}},description:""}}};export{E as P};
