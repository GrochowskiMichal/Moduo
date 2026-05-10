import{j as n}from"./jsx-runtime-u17CrQMm.js";import{r as t}from"./index-B3d2A58Q.js";import{a as S}from"./widget-shell-D7048ePO.js";const M=[{id:"bitcoin",symbol:"BTC",name:"Bitcoin"},{id:"ethereum",symbol:"ETH",name:"Ethereum"}];function D(l){return l>=1e3?`$${l.toLocaleString("en-US",{maximumFractionDigits:0})}`:l>=1?`$${l.toFixed(2)}`:`$${l.toFixed(4)}`}function $({config:l,isLocked:k,onUpdateConfig:u}){const a=l.cryptos??M,[p,N]=t.useState(new Map),[A,b]=t.useState(!1),[x,w]=t.useState(null),[q,j]=t.useState(""),[C,m]=t.useState([]),[g,d]=t.useState(!1),v=t.useRef(null),f=t.useRef(null),c=t.useCallback(async()=>{if(a.length!==0){b(!0),w(null);try{const r=`https://api.coingecko.com/api/v3/simple/price?ids=${a.map(s=>s.id).join(",")}&vs_currencies=usd&include_24hr_change=true`,i=await fetch(r);if(!i.ok)throw new Error("Failed to fetch");const o=await i.json(),y=new Map;for(const s of a){const h=o[s.id];h&&y.set(s.id,{id:s.id,price:h.usd??0,change24h:h.usd_24h_change??0})}N(y)}catch{w("Could not load prices")}finally{b(!1)}}},[a]);t.useEffect(()=>{c();const e=window.setInterval(c,60*1e3);return()=>window.clearInterval(e)},[c]);const L=t.useCallback(async e=>{if(e.length<2){m([]);return}try{const r=`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(e)}`,i=await fetch(r);if(!i.ok)return;const y=((await i.json()).coins??[]).slice(0,8).map(s=>({id:s.id,symbol:s.symbol?.toUpperCase()??"",name:s.name??""}));m(y)}catch{m([])}},[]),I=t.useCallback(e=>{j(e),d(!0),v.current&&clearTimeout(v.current),v.current=setTimeout(()=>{L(e)},350)},[L]),T=t.useCallback(e=>{if(a.some(i=>i.id===e.id))return;const r={id:e.id,symbol:e.symbol,name:e.name};u({cryptos:[...a,r]}),j(""),m([]),d(!1)},[u,a]),E=t.useCallback(e=>{u({cryptos:a.filter(r=>r.id!==e)})},[u,a]);return t.useEffect(()=>{if(!g)return;const e=r=>{f.current&&!f.current.contains(r.target)&&d(!1)};return document.addEventListener("mousedown",e),()=>document.removeEventListener("mousedown",e)},[g]),n.jsx(S,{config:l,title:"Crypto",controls:k?null:n.jsxs("div",{className:"relative",ref:f,children:[n.jsx("input",{value:q,onChange:e=>I(e.target.value),onFocus:()=>q.length>=2&&d(!0),placeholder:"Search coin...",className:"w-[110px] rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] outline-none placeholder:text-[#555] focus:border-[#444]"}),g&&C.length>0?n.jsx("div",{className:"absolute right-0 top-full z-50 mt-1 w-[200px] rounded-lg border border-[#2a2a2a] bg-[#141414] py-1 shadow-xl shadow-black/50",children:C.map(e=>{const r=a.some(i=>i.id===e.id);return n.jsxs("button",{onClick:()=>!r&&T(e),disabled:r,className:`w-full px-3 py-1.5 text-left text-[11px] transition-colors ${r?"text-[#555] cursor-default":"text-[#c0c0c0] hover:bg-[#1e1e1e] hover:text-[#f0f0f0]"}`,children:[n.jsx("span",{className:"font-semibold",children:e.symbol}),n.jsx("span",{className:"text-[#666] ml-1.5",children:e.name}),r?n.jsx("span",{className:"text-[#444] ml-1",children:"added"}):null]},e.id)})}):null]}),children:n.jsx("div",{className:"flex-1 overflow-y-auto px-3 py-2",children:A&&p.size===0?n.jsx("p",{className:"text-[12px] text-[#707070]",children:"Loading prices..."}):x&&p.size===0?n.jsxs("div",{children:[n.jsx("p",{className:"text-[12px] text-[#a06060]",children:x}),n.jsx("button",{onClick:()=>{c()},className:"mt-1 text-[11px] text-[#8a8a8a] hover:text-[#cfcfcf]",children:"Retry"})]}):a.length===0?n.jsx("p",{className:"text-[12px] text-[#707070]",children:"No coins tracked."}):a.map(e=>{const r=p.get(e.id),i=r?.change24h??0,o=i>=0;return n.jsxs("div",{className:"mb-1.5 flex items-center justify-between rounded-lg border border-[#252525] px-2.5 py-1.5",children:[n.jsxs("div",{className:"min-w-0",children:[n.jsxs("div",{className:"flex items-center gap-1.5",children:[n.jsx("span",{className:"text-[13px] font-bold text-[#e8e8e8]",children:e.symbol}),n.jsx("span",{className:"text-[10px] text-[#6a6a6a]",children:e.name})]}),r?n.jsx("p",{className:"text-[13px] text-[#cfcfcf] mt-0.5",children:D(r.price)}):n.jsx("p",{className:"text-[11px] text-[#555]",children:"--"})]}),n.jsxs("div",{className:"flex items-center gap-2",children:[r?n.jsxs("span",{className:`text-[11px] font-semibold ${o?"text-[#4ade80]":"text-[#f87171]"}`,children:[o?"+":"",i.toFixed(2),"%"]}):null,k?null:n.jsx("button",{className:"text-[11px] text-[#8c8c8c] hover:text-[#e9a4a4]",onClick:()=>E(e.id),children:"×"})]})]},e.id)})})})}$.__docgenInfo={description:"",methods:[],displayName:"CryptoWidget",props:{config:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}}],raw:"Partial<WidgetConfig>"},name:"patch"}],return:{name:"void"}}},description:""}}};export{$ as C};
