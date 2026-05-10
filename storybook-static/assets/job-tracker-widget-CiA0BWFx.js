import{j as e}from"./jsx-runtime-u17CrQMm.js";import{r as l}from"./index-B3d2A58Q.js";import{invoke as T}from"./core-DhEqZVGG.js";import{a as _}from"./widget-shell-D7048ePO.js";import{c as m}from"./createLucideIcon-CVEjH9DW.js";import{C as $}from"./calendar-BmLrHsLg.js";const E=[["path",{d:"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",key:"jecpp"}],["rect",{width:"20",height:"14",x:"2",y:"6",rx:"2",key:"i6l2r4"}]],U=m("briefcase",E);const z=[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]],J=m("building-2",z);const W=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",key:"1h4pet"}],["path",{d:"M12 18V6",key:"zqpxq5"}]],P=m("circle-dollar-sign",W);const B=[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]],F=m("hash",B);const G=[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]],R=m("link-2",G);const V=[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]],Y=m("workflow",V),f=["applied","rejected","replied","preinterview","interview","technical","behavioral","staff","decision","hired"],b=["hour","day","week","month","year"];function H(){return typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}function y(){const r=new Date,t=r.getFullYear(),i=String(r.getMonth()+1).padStart(2,"0"),s=String(r.getDate()).padStart(2,"0");return`${t}-${i}-${s}`}function x(r){return r==="preinterview"?"Preinterview":r.charAt(0).toUpperCase()+r.slice(1)}function O(r){return r==="hour"?"h":r==="day"?"d":r==="week"?"w":r==="month"?"m":"y"}function K(r){const t=r.trim().replace(/,/g,""),i=Number(t);return Number.isFinite(i)?Math.abs(i)>=1e3?`${(i/1e3).toFixed(1).replace(/\.0$/,"")}k`:`${i}`:r.trim()}function Q(r,t){const i=new Date(`${r}T00:00:00`);if(Number.isNaN(i.getTime()))return r||"-";const s=i.getDate(),u=i.toLocaleDateString(void 0,{month:"short"});return t?`${s}${u}${i.getFullYear()}`:`${s}${u}`}async function X(r){const t=r.trim();if(t){try{if(typeof window<"u"&&window.__TAURI_INTERNALS__){await T("open_external_url",{url:t});return}}catch{}typeof window<"u"&&window.open(t,"_blank","noopener,noreferrer")}}function Z(r){return Array.isArray(r)?r.filter(t=>t&&typeof t.id=="string").map(t=>({id:t.id,applicationDate:typeof t.applicationDate=="string"?t.applicationDate:y(),offerLink:typeof t.offerLink=="string"?t.offerLink:"",positionName:typeof t.positionName=="string"?t.positionName:"",companyName:typeof t.companyName=="string"?t.companyName:"",salaryAmount:typeof t.salaryAmount=="string"?t.salaryAmount:"",salaryUnit:b.includes(t.salaryUnit)?t.salaryUnit:"year",stage:f.includes(t.stage)?t.stage:"applied"})):[]}function ee({config:r,isLocked:t,onUpdateConfig:i}){const s=Z(r.jobApplications),[u,h]=l.useState(y()),[p,v]=l.useState(""),[c,k]=l.useState(""),[g,j]=l.useState(""),[w,N]=l.useState(""),[q,A]=l.useState("year"),[L,S]=l.useState("applied"),C=l.useMemo(()=>g.trim().length>0||c.trim().length>0||p.trim().length>0,[g,p,c]),M=l.useMemo(()=>{const a=new Set;for(const n of s){const o=new Date(`${n.applicationDate}T00:00:00`);if(!Number.isNaN(o.getTime())&&(a.add(o.getFullYear()),a.size>1))return!0}return!1},[s]),D=()=>{if(!C||t)return;const a={id:H(),applicationDate:u||y(),offerLink:p.trim(),positionName:c.trim(),companyName:g.trim(),salaryAmount:w.trim(),salaryUnit:q,stage:L};i({jobApplications:[a,...s]}),h(y()),v(""),k(""),j(""),N(""),A("year"),S("applied")},I=a=>{t||i({jobApplications:s.filter(n=>n.id!==a)})},d=(a,n)=>{t||i({jobApplications:s.map(o=>o.id===a?{...o,...n}:o)})};return e.jsx(_,{config:r,title:"Job Application Tracker",children:t?e.jsx("div",{className:"h-full min-h-0 overflow-y-auto px-3 py-3",children:s.length===0?e.jsx("p",{className:"text-[12px] text-[#7f7f7f]",children:"No applications."}):e.jsxs("div",{className:"grid gap-1.5",children:[e.jsxs("div",{className:"grid grid-cols-[36px_repeat(6,minmax(0,1fr))] gap-1 text-[#7f7f7f]",children:[e.jsx("span",{className:"flex items-center",children:e.jsx(F,{size:12})}),e.jsx("span",{className:"flex items-center",children:e.jsx(J,{size:12})}),e.jsx("span",{className:"flex items-center",children:e.jsx(U,{size:12})}),e.jsx("span",{className:"flex items-center",children:e.jsx(Y,{size:12})}),e.jsx("span",{className:"flex items-center",children:e.jsx($,{size:12})}),e.jsx("span",{className:"flex items-center",children:e.jsx(P,{size:12})}),e.jsx("span",{className:"flex items-center",children:e.jsx(R,{size:12})})]}),s.map((a,n)=>e.jsxs("div",{className:"grid grid-cols-[36px_repeat(6,minmax(0,1fr))] gap-1 text-[10px] text-[#d8d8d8]",children:[e.jsx("span",{className:"truncate text-[#8f8f8f]",children:n+1}),e.jsx("span",{className:"truncate",children:a.companyName||"-"}),e.jsx("span",{className:"truncate",children:a.positionName||"-"}),e.jsx("span",{className:"truncate",children:x(a.stage)}),e.jsx("span",{className:"truncate",children:Q(a.applicationDate,M)}),e.jsx("span",{className:"truncate",children:a.salaryAmount?`${K(a.salaryAmount)}/${O(a.salaryUnit)}`:"-"}),e.jsx("span",{className:"truncate",children:a.offerLink?e.jsx("a",{href:a.offerLink,target:"_blank",rel:"noreferrer",className:"text-[#d8d8d8] underline decoration-[#3a3a3a] underline-offset-2",onClick:o=>{o.preventDefault(),X(a.offerLink)},children:"Offer link"}):"-"})]},a.id))]})}):e.jsxs("div",{className:"flex h-full min-h-0 flex-col gap-2 px-3 py-3",children:[e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("label",{className:"grid gap-1 text-[11px] text-[#8f8f8f]",children:[e.jsx("span",{children:"Date of application"}),e.jsx("input",{type:"date",value:u,onChange:a=>h(a.target.value),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"})]}),e.jsxs("label",{className:"grid gap-1 text-[11px] text-[#8f8f8f]",children:[e.jsx("span",{children:"Link to offer"}),e.jsx("input",{type:"text",value:p,onChange:a=>v(a.target.value),placeholder:"https://...",className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"})]}),e.jsxs("label",{className:"grid gap-1 text-[11px] text-[#8f8f8f]",children:[e.jsx("span",{children:"Position name"}),e.jsx("input",{type:"text",value:c,onChange:a=>k(a.target.value),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"})]}),e.jsxs("label",{className:"grid gap-1 text-[11px] text-[#8f8f8f]",children:[e.jsx("span",{children:"Company name"}),e.jsx("input",{type:"text",value:g,onChange:a=>j(a.target.value),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"})]}),e.jsxs("label",{className:"grid gap-1 text-[11px] text-[#8f8f8f]",children:[e.jsx("span",{children:"Salary"}),e.jsxs("div",{className:"flex gap-1.5",children:[e.jsx("input",{type:"text",inputMode:"decimal",value:w,onChange:a=>N(a.target.value),placeholder:"120000",className:"min-w-0 flex-1 rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"}),e.jsx("select",{value:q,onChange:a=>A(a.target.value),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none",children:b.map(a=>e.jsxs("option",{value:a,children:["/",a]},a))})]})]}),e.jsxs("label",{className:"grid gap-1 text-[11px] text-[#8f8f8f]",children:[e.jsx("span",{children:"Stage"}),e.jsx("select",{value:L,onChange:a=>S(a.target.value),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none",children:f.map(a=>e.jsx("option",{value:a,children:x(a)},a))})]})]}),e.jsx("button",{type:"button",disabled:!C,onClick:D,className:"rounded border border-[#2b2b2b] bg-[#151515] px-2.5 py-1.5 text-[11px] text-[#d8d8d8] hover:bg-[#1b1b1b] disabled:cursor-not-allowed disabled:opacity-40",children:"+ Add application"}),e.jsx("div",{className:"min-h-0 flex-1 overflow-y-auto",children:s.map(a=>e.jsxs("div",{className:"mb-2 rounded border border-[#2a2a2a] bg-[#131313] p-2",children:[e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("label",{className:"grid gap-1 text-[10px] text-[#7f7f7f]",children:[e.jsx("span",{children:"Company"}),e.jsx("input",{type:"text",value:a.companyName,onChange:n=>d(a.id,{companyName:n.target.value}),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"})]}),e.jsxs("label",{className:"grid gap-1 text-[10px] text-[#7f7f7f]",children:[e.jsx("span",{children:"Position"}),e.jsx("input",{type:"text",value:a.positionName,onChange:n=>d(a.id,{positionName:n.target.value}),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"})]}),e.jsxs("label",{className:"grid gap-1 text-[10px] text-[#7f7f7f]",children:[e.jsx("span",{children:"Stage"}),e.jsx("select",{value:a.stage,onChange:n=>d(a.id,{stage:n.target.value}),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none",children:f.map(n=>e.jsx("option",{value:n,children:x(n)},n))})]}),e.jsxs("label",{className:"grid gap-1 text-[10px] text-[#7f7f7f]",children:[e.jsx("span",{children:"Date"}),e.jsx("input",{type:"date",value:a.applicationDate,onChange:n=>d(a.id,{applicationDate:n.target.value}),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"})]}),e.jsxs("label",{className:"grid gap-1 text-[10px] text-[#7f7f7f]",children:[e.jsx("span",{children:"Salary"}),e.jsxs("div",{className:"flex gap-1.5",children:[e.jsx("input",{type:"text",inputMode:"decimal",value:a.salaryAmount,onChange:n=>d(a.id,{salaryAmount:n.target.value}),className:"min-w-0 flex-1 rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"}),e.jsx("select",{value:a.salaryUnit,onChange:n=>d(a.id,{salaryUnit:n.target.value}),className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none",children:b.map(n=>e.jsxs("option",{value:n,children:["/",n]},n))})]})]}),e.jsxs("label",{className:"grid gap-1 text-[10px] text-[#7f7f7f]",children:[e.jsx("span",{children:"Offer link"}),e.jsx("input",{type:"text",value:a.offerLink,onChange:n=>d(a.id,{offerLink:n.target.value}),placeholder:"https://...",className:"rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"})]})]}),e.jsx("div",{className:"mt-2 flex justify-end",children:e.jsx("button",{type:"button",className:"rounded border border-[#2b2b2b] bg-[#151515] px-2 py-1 text-[10px] text-[#cfcfcf] hover:bg-[#1b1b1b]",onClick:()=>I(a.id),children:"Remove"})})]},a.id))})]})})}ee.__docgenInfo={description:"",methods:[],displayName:"JobTrackerWidget",props:{config:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}}],raw:"Partial<WidgetConfig>"},name:"patch"}],return:{name:"void"}}},description:""}}};export{ee as J};
