import{j as r}from"./jsx-runtime-u17CrQMm.js";import{r as h}from"./index-B3d2A58Q.js";import{a as O}from"./widget-shell-D7048ePO.js";const _={},G=[{symbol:"AAPL",name:"Apple Inc."},{symbol:"MSFT",name:"Microsoft Corp."},{symbol:"GOOGL",name:"Alphabet Inc."},{symbol:"AMZN",name:"Amazon.com Inc."},{symbol:"NVDA",name:"NVIDIA Corp."},{symbol:"META",name:"Meta Platforms Inc."},{symbol:"TSLA",name:"Tesla Inc."},{symbol:"BRK.B",name:"Berkshire Hathaway"},{symbol:"JPM",name:"JPMorgan Chase"},{symbol:"V",name:"Visa Inc."},{symbol:"JNJ",name:"Johnson & Johnson"},{symbol:"WMT",name:"Walmart Inc."},{symbol:"MA",name:"Mastercard Inc."},{symbol:"PG",name:"Procter & Gamble"},{symbol:"HD",name:"Home Depot Inc."},{symbol:"DIS",name:"Walt Disney Co."},{symbol:"NFLX",name:"Netflix Inc."},{symbol:"AMD",name:"AMD Inc."},{symbol:"INTC",name:"Intel Corp."},{symbol:"CRM",name:"Salesforce Inc."},{symbol:"ADBE",name:"Adobe Inc."},{symbol:"PYPL",name:"PayPal Holdings"},{symbol:"BA",name:"Boeing Co."},{symbol:"CSCO",name:"Cisco Systems"},{symbol:"PEP",name:"PepsiCo Inc."},{symbol:"KO",name:"Coca-Cola Co."},{symbol:"UBER",name:"Uber Technologies"},{symbol:"SPOT",name:"Spotify Technology"},{symbol:"SQ",name:"Block Inc."},{symbol:"SNAP",name:"Snap Inc."},{symbol:"SHOP",name:"Shopify Inc."},{symbol:"COIN",name:"Coinbase Global"},{symbol:"PLTR",name:"Palantir Technologies"},{symbol:"ABNB",name:"Airbnb Inc."},{symbol:"RIVN",name:"Rivian Automotive"},{symbol:"NKE",name:"Nike Inc."},{symbol:"SBUX",name:"Starbucks Corp."},{symbol:"XOM",name:"Exxon Mobil Corp."},{symbol:"CVX",name:"Chevron Corp."},{symbol:"GS",name:"Goldman Sachs"}],Y=[{symbol:"AAPL",name:"Apple Inc."},{symbol:"MSFT",name:"Microsoft Corp."}],E=(globalThis.__PUBLIC_ALPHA_VANTAGE_API_KEY__??"")||typeof import.meta<"u"&&_?.PUBLIC_ALPHA_VANTAGE_API_KEY||"",U=(globalThis.__PUBLIC_FINNHUB_API_KEY__??"")||typeof import.meta<"u"&&_?.PUBLIC_FINNHUB_API_KEY||"",R=(globalThis.__PUBLIC_MARKETSTACK_API_KEY__??"")||typeof import.meta<"u"&&_?.PUBLIC_MARKETSTACK_API_KEY||"",J=9e4,B="moduo:stock:marketstack:v1";async function H(t,i){const l=`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(t)}&apikey=${encodeURIComponent(i)}`;try{const n=await fetch(l);if(!n.ok)return null;const a=(await n.json())?.["Global Quote"];if(!a||typeof a!="object")return null;const o=String(a["01. symbol"]??t).toUpperCase(),y=Number(a["05. price"]??0),p=Number(a["09. change"]??0),b=String(a["10. change percent"]??"0"),s=Number(b.replace("%",""))||0;return!Number.isFinite(y)||y<=0?null:{symbol:o,name:o,price:y,changeAmount:Number.isFinite(p)?p:0,changePct:s,fetchedAt:Date.now()}}catch{return null}}function $(t){return t.replace(/\./g,"-")}function z(t){return t.replace(/-/g,".")}async function Q(t){const i=new Map;if(t.length===0)return i;const l=t.map($).join(","),n=await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(l)}`);if(!n.ok)return i;const a=(await n.json())?.quoteResponse?.result;if(!Array.isArray(a))return i;for(const o of a){const y=String(o?.symbol??"").toUpperCase();if(!y)continue;const p=z(y);i.set(p,{symbol:p,name:String(o?.longName??o?.shortName??p),price:Number(o?.regularMarketPrice??0),changeAmount:Number(o?.regularMarketChange??0),changePct:Number(o?.regularMarketChangePercent??0),fetchedAt:Date.now()})}return i}function W(){if(typeof window>"u")return{month:"",count:0,lastCallAt:0};try{const t=window.localStorage.getItem(B);if(!t)return{month:"",count:0,lastCallAt:0};const i=JSON.parse(t);return{month:i.month??"",count:Number(i.count??0),lastCallAt:Number(i.lastCallAt??0)}}catch{return{month:"",count:0,lastCallAt:0}}}function V(t){typeof window>"u"||window.localStorage.setItem(B,JSON.stringify(t))}async function X(t,i){const l=new Map;if(!i||t.length===0)return l;const n=t.join(","),d=`https://api.marketstack.com/v1/eod/latest?access_key=${encodeURIComponent(i)}&symbols=${encodeURIComponent(n)}&limit=100`,a=await fetch(d);if(!a.ok)return l;const o=await a.json(),y=Array.isArray(o?.data)?o.data:[],p=Date.now();for(const b of y){const s=String(b?.symbol??"").toUpperCase(),u=Number(b?.close??0),f=Number(b?.open??u);if(!s||!Number.isFinite(u)||u<=0)continue;const g=Number.isFinite(f)?u-f:0,m=f>0?g/f*100:0;l.set(s,{symbol:s,name:s,price:u,changeAmount:g,changePct:m,fetchedAt:p})}return l}async function Z(t,i){if(!i)return null;const l=`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t)}&token=${encodeURIComponent(i)}`;try{const n=await fetch(l);if(!n.ok)return null;const d=await n.json(),a=Number(d?.c??0);if(!Number.isFinite(a)||a<=0)return null;const o=Number(d?.d??0),y=Number(d?.dp??0);return{symbol:t,name:t,price:a,changeAmount:Number.isFinite(o)?o:0,changePct:Number.isFinite(y)?y:0,fetchedAt:Date.now()}}catch{return null}}async function ee(t,i,l,n,d){const a=new Map;if(t.length===0)return a;const o=new Date().toISOString().slice(0,7),y=W(),p=y.month===o?y:{month:o,count:0,lastCallAt:0};if(!!n&&p.count<95&&(d?.forceMarketstack||Date.now()-p.lastCallAt>480*60*1e3))try{const u=await X(t,n);u.forEach((f,g)=>a.set(g,f)),u.size>0&&V({month:o,count:p.count+1,lastCallAt:Date.now()})}catch{}let s=t.filter(u=>!a.has(u));if(i&&s.length>0){const u=Math.max(0,d?.alphaLimit),f=s.slice(0,u),g=await Promise.all(f.map(m=>H(m,i)));for(const m of g)m&&a.set(m.symbol,m);s=t.filter(m=>!a.has(m))}if(l&&s.length>0){const u=Math.max(0,d?.finnhubLimit),f=s.slice(0,u),g=await Promise.all(f.map(m=>Z(m,l)));for(const m of g)m&&a.set(m.symbol,m);s=t.filter(m=>!a.has(m))}if(s.length>0)try{(await Q(s)).forEach((f,g)=>a.set(g,f))}catch{}return a}function te(t){return t>=1e3?`$${t.toLocaleString("en-US",{maximumFractionDigits:2})}`:`$${t.toFixed(2)}`}function ne({config:t,isLocked:i,onUpdateConfig:l}){const n=t.stocks??Y,[d,a]=h.useState(new Map),[o,y]=h.useState(!1),[p,b]=h.useState(null),[s,u]=h.useState(""),[f,g]=h.useState(!1),[m,D]=h.useState(0),N=h.useRef(null),P=h.useRef(0),x=h.useCallback(async(e=!1)=>{if(n.length===0)return;if(!!!(E||U||R)){b("Missing API key (PUBLIC_ALPHA_VANTAGE_API_KEY / PUBLIC_FINNHUB_API_KEY / PUBLIC_MARKETSTACK_API_KEY)");return}const v=Date.now(),w=n.map(k=>k.symbol).filter(k=>{const A=d.get(k);return!A||v-(A.fetchedAt??0)>J});if(!(!e&&w.length===0)){y(!0),b(null);try{const k=P.current%Math.max(1,w.length||1),A=w.length>0?[...w.slice(k),...w.slice(0,k)]:[];P.current+=1;const q=await ee(A,E,U,R,{forceMarketstack:e,alphaLimit:4,finnhubLimit:20});a(F=>{const S=new Map;for(const I of n){const M=q.get(I.symbol);if(M){S.set(I.symbol,M);continue}const T=F.get(I.symbol);T&&S.set(I.symbol,T)}return S}),q.size===0?b("Could not load quotes"):q.size<A.length&&b("Some quotes unavailable")}catch{b("Could not load quotes")}finally{y(!1)}}},[d,n]);h.useEffect(()=>{x();const e=window.setInterval(x,60*1e3);return()=>window.clearInterval(e)},[x,m]);const C=s.trim().length>0?G.filter(e=>{const c=s.toUpperCase();return!n.some(v=>v.symbol===e.symbol)&&(e.symbol.includes(c)||e.name.toUpperCase().includes(c))}).slice(0,6):[],L=h.useCallback(e=>{n.some(c=>c.symbol===e.symbol)||(l({stocks:[...n,e]}),u(""),g(!1))},[l,n]),j=h.useCallback(()=>{const e=s.trim().toUpperCase();!e||n.some(c=>c.symbol===e)||(l({stocks:[...n,{symbol:e,name:e}]}),u(""),g(!1))},[l,s,n]),K=h.useCallback(e=>{l({stocks:n.filter(c=>c.symbol!==e)})},[l,n]);return h.useEffect(()=>{if(!f)return;const e=c=>{N.current&&!N.current.contains(c.target)&&g(!1)};return document.addEventListener("mousedown",e),()=>document.removeEventListener("mousedown",e)},[f]),r.jsx(O,{config:t,title:"Stocks",className:"flex h-full flex-col overflow-hidden bg-[#111111]",controls:i?null:r.jsxs("div",{className:"relative",ref:N,children:[r.jsx("input",{value:s,onChange:e=>{u(e.target.value),g(!0)},onFocus:()=>s.length>0&&g(!0),onKeyDown:e=>{e.key==="Enter"&&(e.preventDefault(),C.length>0?L(C[0]):s.trim()&&j())},placeholder:"Search ticker...",className:"w-[110px] rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] outline-none placeholder:text-[#555] focus:border-[#444]"}),f&&s.trim().length>0?r.jsxs("div",{className:"absolute right-0 top-full z-50 mt-1 w-[220px] rounded-lg border border-[#2a2a2a] bg-[#141414] py-1 shadow-xl shadow-black/50",children:[C.map(e=>r.jsxs("button",{onClick:()=>L(e),className:"w-full px-3 py-1.5 text-left text-[11px] text-[#c0c0c0] hover:bg-[#1e1e1e] hover:text-[#f0f0f0] transition-colors",children:[r.jsx("span",{className:"font-semibold",children:e.symbol}),r.jsx("span",{className:"text-[#666] ml-1.5",children:e.name})]},e.symbol)),C.length===0?r.jsxs("button",{onClick:j,className:"w-full px-3 py-1.5 text-left text-[11px] text-[#c0c0c0] hover:bg-[#1e1e1e] hover:text-[#f0f0f0] transition-colors",children:["Add ",r.jsx("span",{className:"font-semibold",children:s.trim().toUpperCase()})," as custom ticker"]}):null]}):null]}),children:r.jsx("div",{className:"min-h-0 flex-1 overflow-y-auto px-3 py-2",children:o&&d.size===0?r.jsx("p",{className:"text-[12px] text-[#707070]",children:"Loading quotes..."}):p&&d.size===0?r.jsxs("div",{children:[r.jsx("p",{className:"text-[12px] text-[#a06060]",children:p}),p.includes("PUBLIC_ALPHA_VANTAGE_API_KEY")?r.jsx("p",{className:"mt-1 text-[10px] text-[#7a7a7a]",children:"Add it to `.env.local`, then restart app."}):null,r.jsx("button",{onClick:()=>{D(e=>e+1),x(!0)},disabled:o,className:`mt-1 text-[11px] ${o?"text-[#666666] cursor-not-allowed":"text-[#8a8a8a] hover:text-[#cfcfcf]"}`,children:o?"Retrying...":"Retry"})]}):n.length===0?r.jsx("p",{className:"text-[12px] text-[#707070]",children:"No stocks tracked."}):n.map(e=>{const c=d.get(e.symbol),v=(c?.changePct??0)>=0;return r.jsxs("div",{className:"mb-1.5 flex items-center justify-between rounded-lg border border-[#252525] px-2.5 py-1.5",children:[r.jsxs("div",{className:"min-w-0",children:[r.jsxs("div",{className:"flex items-center gap-1.5",children:[r.jsx("span",{className:"text-[13px] font-bold text-[#e8e8e8]",children:e.symbol}),r.jsx("span",{className:"text-[10px] text-[#6a6a6a] truncate max-w-[80px]",children:c?.name??e.name})]}),c?r.jsx("p",{className:"text-[13px] text-[#cfcfcf] mt-0.5",children:te(c.price)}):o?r.jsx("p",{className:"text-[11px] text-[#555] mt-0.5",children:"loading..."}):r.jsx("p",{className:"text-[11px] text-[#8a6262] mt-0.5",children:"unavailable"})]}),r.jsxs("div",{className:"flex items-center gap-2",children:[c?r.jsxs("span",{className:`text-[11px] font-semibold ${v?"text-[#4ade80]":"text-[#f87171]"}`,children:[v?"+":"",c.changePct.toFixed(2),"%"]}):null,i?null:r.jsx("button",{className:"text-[11px] text-[#8c8c8c] hover:text-[#e9a4a4]",onClick:()=>K(e.symbol),children:"×"})]})]},e.symbol)})})})}ne.__docgenInfo={description:"",methods:[],displayName:"StockWidget",props:{config:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}}],raw:"Partial<WidgetConfig>"},name:"patch"}],return:{name:"void"}}},description:""}}};export{ne as S};
