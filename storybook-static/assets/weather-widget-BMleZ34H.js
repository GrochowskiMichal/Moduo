import{j as t}from"./jsx-runtime-u17CrQMm.js";import{r}from"./index-B3d2A58Q.js";import{a as S}from"./widget-shell-D7048ePO.js";const M={0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Foggy",48:"Rime fog",51:"Light drizzle",53:"Drizzle",55:"Dense drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",80:"Light showers",81:"Showers",82:"Heavy showers",95:"Thunderstorm"};function W(n,l){return n===0?l?"☀":"☾":n<=2?l?"⛅":"☁":n===3||n<=48?"☁":n<=55||n<=65?"🌧":n<=75?"❄":n<=82?"🌦":"⛈"}const D=40.71,R=-74.01,z="New York";function U({config:n,isLocked:l,onUpdateConfig:v}){const[i,A]=r.useState(null),[C,h]=r.useState(!1),[f,k]=r.useState(null),[w,b]=r.useState(""),[q,o]=r.useState([]),[c,u]=r.useState(!1),y=r.useRef(null),p=r.useRef(null),x=n.weatherLat??D,L=n.weatherLon??R,T=n.weatherCity??z,m=r.useCallback(async()=>{h(!0),k(null);try{const e=`https://api.open-meteo.com/v1/forecast?latitude=${x}&longitude=${L}&current_weather=true`,a=await fetch(e);if(!a.ok)throw new Error("Failed to fetch");const s=(await a.json()).current_weather;A({temperature:s.temperature,windspeed:s.windspeed,weathercode:s.weathercode,isDay:s.is_day===1})}catch{k("Could not load weather")}finally{h(!1)}},[x,L]);r.useEffect(()=>{m();const e=window.setInterval(m,600*1e3);return()=>window.clearInterval(e)},[m]);const j=r.useCallback(async e=>{if(e.length<2){o([]);return}try{const a=`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(e)}&count=6&language=en&format=json`,g=await fetch(a);if(!g.ok)return;const E=((await g.json()).results??[]).map(d=>({name:d.name,country:d.country??"",latitude:d.latitude,longitude:d.longitude}));o(E)}catch{o([])}},[]),I=r.useCallback(e=>{b(e),u(!0),y.current&&clearTimeout(y.current),y.current=setTimeout(()=>{j(e)},300)},[j]),N=r.useCallback(e=>{const a=e.country?`${e.name}, ${e.country}`:e.name;v({weatherCity:a,weatherLat:e.latitude,weatherLon:e.longitude}),b(""),o([]),u(!1)},[v]);return r.useEffect(()=>{if(!c)return;const e=a=>{p.current&&!p.current.contains(a.target)&&u(!1)};return document.addEventListener("mousedown",e),()=>document.removeEventListener("mousedown",e)},[c]),t.jsx(S,{config:n,title:"Weather",controls:l?null:t.jsxs("div",{className:"relative",ref:p,children:[t.jsx("input",{value:w,onChange:e=>I(e.target.value),onFocus:()=>w.length>=2&&u(!0),placeholder:"Search city...",className:"w-[120px] rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] outline-none placeholder:text-[#555] focus:border-[#444]"}),c&&q.length>0?t.jsx("div",{className:"absolute right-0 top-full z-50 mt-1 w-[200px] rounded-lg border border-[#2a2a2a] bg-[#141414] py-1 shadow-xl shadow-black/50",children:q.map((e,a)=>t.jsxs("button",{onClick:()=>N(e),className:"w-full px-3 py-1.5 text-left text-[11px] text-[#c0c0c0] hover:bg-[#1e1e1e] hover:text-[#f0f0f0] transition-colors",children:[e.name,e.country?t.jsx("span",{className:"text-[#666] ml-1",children:e.country}):null]},`${e.latitude}-${e.longitude}-${a}`))}):null]}),children:t.jsx("div",{className:"flex-1 flex flex-col items-center justify-center px-3 py-3",children:C&&!i?t.jsx("p",{className:"text-[12px] text-[#707070]",children:"Loading..."}):f?t.jsxs("div",{className:"text-center",children:[t.jsx("p",{className:"text-[12px] text-[#a06060]",children:f}),t.jsx("button",{onClick:()=>{m()},className:"mt-2 text-[11px] text-[#8a8a8a] hover:text-[#cfcfcf]",children:"Retry"})]}):i?t.jsxs(t.Fragment,{children:[t.jsx("p",{className:"text-[11px] text-[#8d8d8d] mb-1",children:T}),t.jsx("p",{className:"text-[36px] leading-none",children:W(i.weathercode,i.isDay)}),t.jsxs("p",{className:"mt-2 text-[28px] font-bold text-[#f1f1f1] leading-none",children:[Math.round(i.temperature),"°C"]}),t.jsx("p",{className:"mt-1 text-[12px] text-[#8d8d8d]",children:M[i.weathercode]??"Unknown"}),t.jsxs("p",{className:"mt-1 text-[10px] text-[#6a6a6a]",children:["Wind ",i.windspeed," km/h"]})]}):null})})}U.__docgenInfo={description:"",methods:[],displayName:"WeatherWidget",props:{config:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}}],raw:"Partial<WidgetConfig>"},name:"patch"}],return:{name:"void"}}},description:""}}};export{U as W};
