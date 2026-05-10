import{j as i}from"./jsx-runtime-u17CrQMm.js";import{r as g}from"./index-B3d2A58Q.js";import{a as q}from"./widget-shell-D7048ePO.js";function T(e,t){return new Date(e,t+1,0).getDate()}function h(e,t){const r=e.getFullYear(),u=e.getMonth()+t,m=r+Math.floor(u/12),s=(u%12+12)%12,o=new Date(e),d=Math.min(e.getDate(),T(m,s));return o.setFullYear(m,s,d),o}function N(e,t){if(!(t instanceof Date)||Number.isNaN(t.getTime())||t.getTime()<=e.getTime())return{years:0,months:0,days:0,hours:0,minutes:0,seconds:0,totalSeconds:0,isComplete:!0};let r=new Date(e),l=0;for(;;){const a=h(r,12);if(a.getTime()>t.getTime())break;r=a,l+=1}let u=0;for(;;){const a=h(r,1);if(a.getTime()>t.getTime())break;r=a,u+=1}let m=0;for(;;){const a=new Date(r);if(a.setDate(a.getDate()+1),a.getTime()>t.getTime())break;r=a,m+=1}const s=Math.max(0,t.getTime()-r.getTime()),o=Math.floor((t.getTime()-e.getTime())/1e3),d=Math.floor(s/36e5),p=Math.floor(s%36e5/6e4),y=Math.floor(s%6e4/1e3);return{years:l,months:u,days:m,hours:d,minutes:p,seconds:y,totalSeconds:o,isComplete:!1}}function k(e){if(!e)return"";const t=new Date(e);if(Number.isNaN(t.getTime()))return"";const r=t.getFullYear(),l=String(t.getMonth()+1).padStart(2,"0"),u=String(t.getDate()).padStart(2,"0"),m=String(t.getHours()).padStart(2,"0"),s=String(t.getMinutes()).padStart(2,"0"),o=String(t.getSeconds()).padStart(2,"0");return`${r}-${l}-${u}T${m}:${s}:${o}`}function M(e){const t=e.trim();if(!t)return null;const r=t.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);if(r){const[,u,m,s,o,d,p]=r,y=new Date(Number(u),Number(m)-1,Number(s),Number(o),Number(d),Number(p??"0"),0);if(!Number.isNaN(y.getTime()))return y}const l=new Date(t);return Number.isNaN(l.getTime())?null:l}function j({config:e,isLocked:t,onUpdateConfig:r}){const[l,u]=g.useState(()=>new Date),[m,s]=g.useState(()=>k(e.countdownTargetIso)),[o,d]=g.useState(()=>{const n=e.countdownTargetIso?new Date(e.countdownTargetIso):null;return n&&!Number.isNaN(n.getTime())?n.getTime():null}),p=(e.countdownTitle??"").trim()||"Countdown",y=(e.countdownTitle??"").trim().length>0;g.useEffect(()=>{s(k(e.countdownTargetIso));const n=e.countdownTargetIso?new Date(e.countdownTargetIso):null;d(n&&!Number.isNaN(n.getTime())?n.getTime():null)},[e.countdownTargetIso]),g.useEffect(()=>{const n=window.setInterval(()=>u(new Date),250);return()=>window.clearInterval(n)},[]);const a=g.useMemo(()=>{if(!e.countdownTargetIso)return null;const n=new Date(e.countdownTargetIso);return Number.isNaN(n.getTime())?null:n},[e.countdownTargetIso]),w=e.countdownActive===!0&&!!a,c=g.useMemo(()=>a?N(l,a):{years:0,months:0,days:0,hours:0,minutes:0,seconds:0,totalSeconds:0,isComplete:!1},[l,a]),f=a?w?c.isComplete?"Countdown complete.":null:"Press Start to begin countdown.":"Set a date and time to start the countdown.",x=g.useMemo(()=>{const n=[{label:"Years",value:c.years},{label:"Months",value:c.months},{label:"Days",value:c.days},{label:"Hours",value:c.hours},{label:"Minutes",value:c.minutes},{label:"Seconds",value:c.seconds}];if(!w)return n.slice(3);const v=n.findIndex(b=>b.value>0);return c.isComplete||v===-1?[{label:"Seconds",value:0}]:n.slice(v)},[c,w]);return i.jsx(q,{config:e,title:p,children:t?i.jsxs("div",{className:"flex h-full min-h-0 flex-col px-3 py-3",children:[i.jsx("p",{className:"truncate text-[11px] text-[#8f8f8f]",children:p}),i.jsx("div",{className:"mt-3 grid gap-2",style:{gridTemplateColumns:"repeat(auto-fit, minmax(88px, 1fr))"},children:x.map(n=>i.jsx(I,{label:n.label,value:n.value},n.label))}),f?i.jsx("p",{className:"mt-3 text-[11px] text-[#777777]",children:f}):null]}):i.jsx("div",{className:"flex h-full items-center justify-center px-3 py-3",children:i.jsxs("div",{className:"flex w-full max-w-[420px] flex-col gap-2",children:[i.jsx("input",{type:"text",value:e.countdownTitle??"",onChange:n=>r({countdownTitle:n.target.value}),placeholder:"Title",className:"w-full rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#cfcfcf] outline-none"}),i.jsxs("div",{className:"flex w-full flex-wrap items-center justify-center gap-2",children:[i.jsx("input",{type:"text",inputMode:"numeric",value:m,placeholder:"YYYY-MM-DDTHH:mm:ss",onChange:n=>{const v=n.target.value;if(s(v),!v){d(null),r({countdownTargetIso:void 0,countdownActive:!1});return}const b=M(v);d(b?b.getTime():null),r({countdownActive:!1})},className:"min-w-[150px] flex-1 rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#cfcfcf] outline-none selection:bg-[#24553a] selection:text-[#e7fff2]"}),i.jsx("button",{type:"button",disabled:o==null||!y,onClick:()=>{o==null||!y||r({countdownTargetIso:new Date(o).toISOString(),countdownActive:!0})},className:`rounded border px-3 py-1.5 text-[11px] ${o!=null&&y?e.countdownActive?"border-[#24553a] bg-[#163324] text-[#9fe2bc]":"border-[#2b2b2b] bg-[#141414] text-[#d8d8d8] hover:bg-[#1b1b1b]":"cursor-not-allowed border-[#232323] bg-[#121212] text-[#666666]"}`,children:e.countdownActive?"Started":"Start"})]})]})})})}function I({label:e,value:t}){return i.jsxs("div",{className:"rounded-lg border border-[#252525] bg-[#151515] px-2 py-2 text-center",children:[i.jsx("p",{className:"text-[19px] font-semibold leading-none text-[#f1f1f1]",children:t}),i.jsx("p",{className:"mt-1 text-[10px] uppercase tracking-[0.08em] text-[#8a8a8a]",children:e})]})}j.__docgenInfo={description:"",methods:[],displayName:"CountdownWidget",props:{config:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}}],raw:"Partial<WidgetConfig>"},name:"patch"}],return:{name:"void"}}},description:""}}};export{j as C};
