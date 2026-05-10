import{j as n}from"./jsx-runtime-u17CrQMm.js";import{r as a}from"./index-B3d2A58Q.js";import{F as w}from"./feature-panels-shell-BdfMhs37.js";import{r as j,l as V,B as N,s as O,a as U}from"./layout-events-BLkgTf9Y.js";import{r as z,L as C,d as G}from"./panel-events-BeJSmLTW.js";import{A as $}from"./affinity-diagram-visual-rapC9TRJ.js";import{B as Q}from"./brain-dump-visual-CAOiyGFj.js";import{B as J}from"./buyer-persona-visual-BWcc-DF_.js";import{C as Y}from"./constraint-identification-visual-DFAqDGhp.js";import{E as X}from"./eisenhower-matrix-visual-uXGew1oy.js";import{F as Z}from"./five-whys-visual-D0Odv015.js";import{N as ee}from"./ngt-visual-DS74EBog.js";import{P as ne}from"./pestel-visual-4KojK4n_.js";import{P as re}from"./porters-five-visual-BRr1Hagp.js";import{R as te}from"./reverse-brainstorming-visual-CEw8D25x.js";import{R as ie}from"./rice-scoring-visual-C9tmKRtP.js";import{S as ae}from"./scamper-visual-CZI3GYJZ.js";import{S as se}from"./six-thinking-hats-visual-BroXWs_m.js";import{S as oe}from"./starbursting-visual-BPf1bvBJ.js";import{S as le,P as ue}from"./swot-visual-D3U13jdj.js";import{W as me}from"./what-if-visual-D_zhqQQE.js";import{F as de}from"./framework-poster-CXGAnNfZ.js";import{T as ce}from"./trash-2-BqP-bbSU.js";import"./core.esm-P1l0hGcK.js";import"./index-BEwfMeI6.js";import"./index-AOmQ1fUN.js";import"./sortable.esm-BobJm2SG.js";import"./createLucideIcon-CVEjH9DW.js";const pe={id:"ngt",name:"Nominal Group Technique",description:"Structured group decision-making with silent idea generation, round-robin sharing, and ranked voting.",icon:"🗳️",color:"#6366f1",fields:[{key:"question",label:"Central Question",placeholder:"What problem or topic are we addressing?",multiline:!1},{key:"individual_ideas",label:"Individual Ideas",placeholder:"List all ideas generated silently by participants...",multiline:!0},{key:"discussion",label:"Discussion & Clarification",placeholder:"Notes from the round-robin discussion...",multiline:!0},{key:"voting",label:"Voting & Ranking",placeholder:"Record votes and rankings for each idea...",multiline:!0},{key:"final_list",label:"Final Prioritized List",placeholder:"Top ideas after voting...",multiline:!0},{key:"action_items",label:"Action Items",placeholder:"Next steps based on the prioritized ideas...",multiline:!0}]},ye={id:"five-whys",name:"The 5 Whys",description:"Iterative root-cause analysis by asking 'why' five times to drill down to the core issue.",icon:"🔍",color:"#f59e0b",fields:[{key:"problem",label:"Problem Statement",placeholder:"Clearly define the problem you're investigating...",multiline:!1},{key:"why1",label:"Why 1",placeholder:"Why is this happening?",multiline:!0},{key:"why2",label:"Why 2",placeholder:"Why is that?",multiline:!0},{key:"why3",label:"Why 3",placeholder:"And why is that?",multiline:!0},{key:"why4",label:"Why 4",placeholder:"Why does that occur?",multiline:!0},{key:"why5",label:"Why 5",placeholder:"What is the underlying reason?",multiline:!0},{key:"root_cause",label:"Root Cause",placeholder:"The fundamental cause identified...",multiline:!0},{key:"action_plan",label:"Action Plan",placeholder:"Steps to address the root cause...",multiline:!0}]},ge={id:"swot",name:"SWOT Analysis",description:"Evaluate Strengths, Weaknesses, Opportunities, and Threats for strategic planning.",icon:"📊",color:"#10b981",fields:[{key:"subject",label:"Subject / Topic",placeholder:"What are you analyzing? (product, company, project...)",multiline:!1},{key:"strengths",label:"Strengths",placeholder:"Internal advantages and positive attributes...",multiline:!0},{key:"weaknesses",label:"Weaknesses",placeholder:"Internal limitations and areas for improvement...",multiline:!0},{key:"opportunities",label:"Opportunities",placeholder:"External factors you could leverage...",multiline:!0},{key:"threats",label:"Threats",placeholder:"External risks and challenges...",multiline:!0},{key:"action_items",label:"Action Items",placeholder:"Strategic actions based on the analysis...",multiline:!0}]},he={id:"porters-five",name:"Porter's 5 Forces",description:"Analyze the competitive forces shaping an industry to understand profitability and strategy.",icon:"⚔️",color:"#ef4444",fields:[{key:"industry",label:"Industry / Market",placeholder:"Which industry or market are you analyzing?",multiline:!1},{key:"new_entrants",label:"Threat of New Entrants",placeholder:"Barriers to entry, capital requirements, brand loyalty...",multiline:!0},{key:"supplier_power",label:"Bargaining Power of Suppliers",placeholder:"Supplier concentration, switching costs, substitute inputs...",multiline:!0},{key:"buyer_power",label:"Bargaining Power of Buyers",placeholder:"Buyer volume, price sensitivity, switching costs...",multiline:!0},{key:"substitutes",label:"Threat of Substitutes",placeholder:"Alternative products, price-performance trade-offs...",multiline:!0},{key:"rivalry",label:"Competitive Rivalry",placeholder:"Number of competitors, industry growth, differentiation...",multiline:!0},{key:"implications",label:"Strategic Implications",placeholder:"Key takeaways and strategic positioning...",multiline:!0}]},ve={id:"pestel",name:"PESTEL Analysis",description:"Macro-environmental analysis across Political, Economic, Social, Technological, Environmental, and Legal factors.",icon:"🌍",color:"#8b5cf6",fields:[{key:"context",label:"Subject / Context",placeholder:"What decision or strategy is this analysis supporting?",multiline:!1},{key:"political",label:"Political Factors",placeholder:"Government policy, regulations, trade restrictions, political stability...",multiline:!0},{key:"economic",label:"Economic Factors",placeholder:"Growth rates, inflation, exchange rates, disposable income...",multiline:!0},{key:"social",label:"Social Factors",placeholder:"Demographics, cultural trends, lifestyle changes, education...",multiline:!0},{key:"technological",label:"Technological Factors",placeholder:"Innovation, automation, R&D activity, tech infrastructure...",multiline:!0},{key:"environmental",label:"Environmental Factors",placeholder:"Climate, sustainability, waste management, ecological regulations...",multiline:!0},{key:"legal",label:"Legal Factors",placeholder:"Employment law, consumer protection, health & safety, IP...",multiline:!0},{key:"insights",label:"Key Insights",placeholder:"Most impactful factors and recommended actions...",multiline:!0}]},ke={id:"buyer-persona",name:"Buyer Persona",description:"Build a detailed profile of your ideal customer to guide marketing and product decisions.",icon:"👤",color:"#ec4899",fields:[{key:"name",label:"Persona Name",placeholder:"Give this persona a name (e.g. 'Startup Sarah')...",multiline:!1},{key:"demographics",label:"Demographics",placeholder:"Age, location, job title, income, education, family status...",multiline:!0},{key:"goals",label:"Goals & Motivations",placeholder:"What are they trying to achieve? What drives them?",multiline:!0},{key:"pain_points",label:"Pain Points & Challenges",placeholder:"What frustrates them? What obstacles do they face?",multiline:!0},{key:"behavior",label:"Behavior Patterns",placeholder:"How do they research? Where do they spend time online?",multiline:!0},{key:"channels",label:"Preferred Channels",placeholder:"Social media, email, forums, events, podcasts...",multiline:!0},{key:"triggers",label:"Buying Triggers",placeholder:"What events or situations prompt a purchase decision?",multiline:!0},{key:"objections",label:"Common Objections",placeholder:"What concerns might prevent them from buying?",multiline:!0},{key:"how_we_help",label:"How We Help",placeholder:"How does our product/service solve their problems?",multiline:!0}]},be={id:"scamper",name:"SCAMPER",description:"Creative thinking technique: Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse.",icon:"💡",color:"#f97316",fields:[{key:"subject",label:"Subject / Product",placeholder:"What product, service, or process are you reimagining?",multiline:!1},{key:"substitute",label:"Substitute",placeholder:"What components, materials, or processes can be replaced?",multiline:!0},{key:"combine",label:"Combine",placeholder:"What ideas, features, or steps can be merged together?",multiline:!0},{key:"adapt",label:"Adapt",placeholder:"What can be borrowed from other contexts or industries?",multiline:!0},{key:"modify",label:"Modify / Magnify",placeholder:"What can be enlarged, emphasized, or changed in form?",multiline:!0},{key:"put_to_use",label:"Put to Other Uses",placeholder:"How else could this be used? Who else could benefit?",multiline:!0},{key:"eliminate",label:"Eliminate",placeholder:"What can be removed, simplified, or reduced?",multiline:!0},{key:"reverse",label:"Reverse / Rearrange",placeholder:"What if you reversed the order, roles, or layout?",multiline:!0},{key:"best_ideas",label:"Best Ideas",placeholder:"Most promising ideas from the exercise...",multiline:!0}]},Pe={id:"six-thinking-hats",name:"Six Thinking Hats",description:"De Bono's method for exploring decisions from six distinct perspectives for balanced thinking.",icon:"🎩",color:"#14b8a6",fields:[{key:"topic",label:"Topic / Decision",placeholder:"What decision or topic are you exploring?",multiline:!1},{key:"white",label:"White Hat — Facts & Information",placeholder:"What data and facts do we have? What information is missing?",multiline:!0},{key:"red",label:"Red Hat — Feelings & Intuition",placeholder:"What are your gut reactions? How do people feel about this?",multiline:!0},{key:"black",label:"Black Hat — Caution & Risks",placeholder:"What could go wrong? What are the dangers and weaknesses?",multiline:!0},{key:"yellow",label:"Yellow Hat — Benefits & Optimism",placeholder:"What are the advantages? Why could this work?",multiline:!0},{key:"green",label:"Green Hat — Creativity & Alternatives",placeholder:"What are creative solutions? What new ideas emerge?",multiline:!0},{key:"blue",label:"Blue Hat — Process & Summary",placeholder:"What is the overall picture? What are the next steps?",multiline:!0},{key:"conclusion",label:"Decision / Conclusion",placeholder:"Final decision or recommendation based on all perspectives...",multiline:!0}]},we={id:"constraint-identification",name:"Constraint Identification",description:"Systematically identify and plan around project constraints across key dimensions.",icon:"🚧",color:"#eab308",fields:[{key:"goal",label:"Project / Goal",placeholder:"What project or goal are you scoping?",multiline:!1},{key:"time",label:"Time Constraints",placeholder:"Deadlines, milestones, schedule dependencies...",multiline:!0},{key:"budget",label:"Budget Constraints",placeholder:"Financial limits, cost drivers, funding gaps...",multiline:!0},{key:"resources",label:"Resource Constraints",placeholder:"Team size, skill gaps, tool limitations...",multiline:!0},{key:"technical",label:"Technical Constraints",placeholder:"Technology limits, legacy systems, scalability...",multiline:!0},{key:"regulatory",label:"Regulatory Constraints",placeholder:"Compliance, legal requirements, industry standards...",multiline:!0},{key:"other",label:"Other Constraints",placeholder:"Organizational, political, cultural, geographic...",multiline:!0},{key:"mitigation",label:"Mitigation Strategies",placeholder:"How will you work within or around these constraints?",multiline:!0},{key:"priorities",label:"Priority Actions",placeholder:"Most critical constraints to address first...",multiline:!0}]},fe={id:"what-if",name:"What If Analysis",description:"Explore hypothetical scenarios to uncover opportunities, risks, and contingency plans.",icon:"🔮",color:"#a855f7",fields:[{key:"scenario",label:"Scenario Title",placeholder:"Give this scenario a descriptive name...",multiline:!1},{key:"what_if",label:"What If...",placeholder:"Describe the hypothetical situation in detail...",multiline:!0},{key:"outcomes",label:"Potential Outcomes",placeholder:"What would likely happen as a result?",multiline:!0},{key:"opportunities",label:"Opportunities Created",placeholder:"What new possibilities would this open up?",multiline:!0},{key:"risks",label:"Risks Introduced",placeholder:"What dangers or downsides would emerge?",multiline:!0},{key:"impact",label:"Impact Assessment",placeholder:"How significant is this scenario? Who would be affected?",multiline:!0},{key:"preparation",label:"Preparation Steps",placeholder:"What can we do now to prepare for or prevent this?",multiline:!0}]},qe={id:"reverse-brainstorming",name:"Reverse Brainstorming",description:"Solve problems by first brainstorming ways to cause them, then reversing those ideas into solutions.",icon:"🔄",color:"#06b6d4",fields:[{key:"problem",label:"Problem to Solve",placeholder:"What problem are you trying to fix?",multiline:!1},{key:"cause_ideas",label:"How Could We Cause This Problem?",placeholder:"Brainstorm ways to make the problem worse...",multiline:!0},{key:"worst_ideas",label:"Ideas That Make It Worse",placeholder:"List the most impactful negative ideas...",multiline:!0},{key:"reversed",label:"Reverse Each Idea",placeholder:"Flip each negative idea into a positive solution...",multiline:!0},{key:"viable",label:"Viable Solutions",placeholder:"Which reversed ideas are most practical and effective?",multiline:!0},{key:"action_plan",label:"Action Plan",placeholder:"Steps to implement the best solutions...",multiline:!0}]},Ie={id:"starbursting",name:"Starbursting (5W1H)",description:"Generate comprehensive questions using Who, What, Where, When, Why, and How to explore an idea.",icon:"⭐",color:"#f43f5e",fields:[{key:"subject",label:"Subject / Idea",placeholder:"What idea, product, or initiative are you exploring?",multiline:!1},{key:"who",label:"Who?",placeholder:"Who is involved? Who benefits? Who is the target audience?",multiline:!0},{key:"what",label:"What?",placeholder:"What is it? What does it do? What problem does it solve?",multiline:!0},{key:"where",label:"Where?",placeholder:"Where will it be used? Where will it be sold/deployed?",multiline:!0},{key:"when",label:"When?",placeholder:"When will it launch? When is the best timing?",multiline:!0},{key:"why",label:"Why?",placeholder:"Why is this needed? Why now? Why would people want this?",multiline:!0},{key:"how",label:"How?",placeholder:"How will it work? How will it be built? How will it be marketed?",multiline:!0},{key:"insights",label:"Key Insights",placeholder:"Most important findings from the questioning process...",multiline:!0}]},Se={id:"rice-scoring",name:"RICE Scoring",description:"Prioritize features or initiatives by evaluating Reach, Impact, Confidence, and Effort.",icon:"📐",color:"#0ea5e9",fields:[{key:"initiative",label:"Feature / Initiative",placeholder:"What are you evaluating for prioritization?",multiline:!1},{key:"reach",label:"Reach",placeholder:"How many users/customers will this affect in a given period?",multiline:!0},{key:"impact",label:"Impact",placeholder:"How much will this impact each user? (Massive / High / Medium / Low / Minimal)",multiline:!0},{key:"confidence",label:"Confidence",placeholder:"How confident are you in these estimates? (High / Medium / Low)",multiline:!0},{key:"effort",label:"Effort",placeholder:"How much work is required? (person-months, story points...)",multiline:!0},{key:"score_notes",label:"RICE Score & Notes",placeholder:"Calculate: (Reach x Impact x Confidence) / Effort. Notes on the result...",multiline:!0},{key:"decision",label:"Decision",placeholder:"Prioritize, defer, or drop? Reasoning...",multiline:!0}]},xe={id:"brain-dump",name:"Brain Dump",description:"Free-form idea capture followed by pattern recognition and prioritization.",icon:"🧠",color:"#d946ef",fields:[{key:"topic",label:"Topic / Focus Area",placeholder:"What area or challenge are you dumping ideas about?",multiline:!1},{key:"raw_ideas",label:"Raw Ideas & Thoughts",placeholder:"Write everything that comes to mind, no filtering...",multiline:!0},{key:"patterns",label:"Patterns & Themes",placeholder:"What clusters or themes emerge from the ideas above?",multiline:!0},{key:"priorities",label:"Priority Items",placeholder:"Which ideas feel most important or actionable?",multiline:!0},{key:"next_steps",label:"Next Steps",placeholder:"Immediate actions to take based on this dump...",multiline:!0}]},je={id:"affinity-diagram",name:"Affinity Diagram",description:"Organize large amounts of data or ideas into natural groupings to find patterns and insights.",icon:"🗂️",color:"#84cc16",fields:[{key:"question",label:"Research Question",placeholder:"What question or problem are you organizing data around?",multiline:!1},{key:"raw_data",label:"Raw Data / Observations",placeholder:"All individual data points, observations, or sticky notes...",multiline:!0},{key:"group1",label:"Group 1",placeholder:"Theme name + grouped items...",multiline:!0},{key:"group2",label:"Group 2",placeholder:"Theme name + grouped items...",multiline:!0},{key:"group3",label:"Group 3",placeholder:"Theme name + grouped items...",multiline:!0},{key:"group4",label:"Group 4",placeholder:"Theme name + grouped items...",multiline:!0},{key:"conclusions",label:"Insights & Conclusions",placeholder:"What patterns emerged? What actions do the groups suggest?",multiline:!0}]},Re={id:"eisenhower-matrix",name:"Eisenhower Matrix",description:"Prioritize tasks by urgency and importance into four quadrants: Do, Schedule, Delegate, Eliminate.",icon:"⚡",color:"#0891b2",fields:[{key:"context",label:"Context / Focus Area",placeholder:"What scope of work are you prioritizing?",multiline:!1},{key:"q1_do",label:"Q1 — Urgent & Important (Do First)",placeholder:"Critical deadlines, crises, pressing problems...",multiline:!0},{key:"q2_schedule",label:"Q2 — Not Urgent & Important (Schedule)",placeholder:"Strategic planning, relationship building, personal growth...",multiline:!0},{key:"q3_delegate",label:"Q3 — Urgent & Not Important (Delegate)",placeholder:"Interruptions, some meetings, certain emails...",multiline:!0},{key:"q4_eliminate",label:"Q4 — Not Urgent & Not Important (Eliminate)",placeholder:"Time wasters, busywork, pleasant but unproductive activities...",multiline:!0},{key:"takeaways",label:"Key Takeaways",placeholder:"What will you focus on? What will you stop doing?",multiline:!0}]},E=[ge,ye,ke,be,Pe,he,ve,pe,we,fe,qe,Ie,Se,xe,je,Re],R=new Map(E.map(s=>[s.id,s])),We={swot:le,"five-whys":Z,"buyer-persona":J,scamper:ae,"six-thinking-hats":se,"porters-five":re,pestel:ne,ngt:ee,"constraint-identification":Y,"what-if":me,"reverse-brainstorming":te,starbursting:oe,"rice-scoring":ie,"brain-dump":Q,"affinity-diagram":$,"eisenhower-matrix":X};function Te(){return typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}function f(){return new Date().toISOString()}function M({workspaceId:s,runtime:p}){const[m,I]=a.useState(()=>j(s)),[B,F]=a.useState(0),[o,d]=a.useState([]),[S,k]=a.useState([]),[c,g]=a.useState(null),[L,x]=a.useState(!1),h=a.useRef(!1),b=a.useRef("");a.useEffect(()=>{if(typeof window>"u")return;const e=i=>{G({feature:"brainstorm",left:i,right:!1})},t=z("brainstorm");t.right&&e(t.left);const r=i=>{const l=i.detail;!l||l.feature!=="brainstorm"||!l.right||e(l.left)};return window.addEventListener(C,r),()=>window.removeEventListener(C,r)},[]);const P=a.useCallback(async()=>{const e=await V(p,s);F(e.length),I(t=>{if(t&&e.some(i=>i.id===t))return t;const r=j(s);return r&&e.some(i=>i.id===r)?r:e[0]?.id??null})},[p,s]);a.useEffect(()=>{P()},[P]),a.useEffect(()=>{I(j(s))},[s]),a.useEffect(()=>{if(typeof window>"u")return;const e=t=>{const r=t.detail;I(r?.viewId??null),P()};return window.addEventListener(N,e),()=>window.removeEventListener(N,e)},[P]),a.useEffect(()=>{let e=!0;return(async()=>{if(!m){h.current=!0,d([]),k([]),g(null),b.current="",h.current=!1,x(!1);return}x(!0),h.current=!0;try{const r=await U(p,s,m);if(!e)return;const i=Array.isArray(r?.entries)?r.entries:[],l=Array.isArray(r?.edges)?r.edges:[];d(i),k(l),g(i[0]?.id??null),b.current=JSON.stringify({entries:i,edges:l})}catch{if(!e)return;d([]),k([])}finally{if(!e)return;h.current=!1,x(!1)}})(),()=>{e=!1}},[p,s,m]),a.useEffect(()=>{if(!m||h.current)return;const e=JSON.stringify({entries:o,edges:S});if(e===b.current)return;const t=window.setTimeout(()=>{O(p,s,m,{entries:o,edges:S,updatedAt:f()}).then(()=>{b.current=e})},350);return()=>window.clearTimeout(t)},[p,s,m,o,S]);const _=a.useCallback(e=>{const t=R.get(e);if(!t)return;const r=f(),i={};for(const u of t.fields)i[u.key]="";if(e==="swot")for(const u of["strengths","weaknesses","opportunities","threats"])i[u]="• ",i[`${u}_cards`]=JSON.stringify([{id:`${u}-seed`,text:""}]),i[`${u}_value`]="0",i[`${u}_weight`]="1";const l={id:Te(),templateId:e,name:t.name,fields:i,createdAt:r,updatedAt:r};d(u=>u.concat(l)),g(l.id)},[]),W=a.useCallback(e=>{c&&d(t=>t.map(r=>r.id===c?{...r,name:e,updatedAt:f()}:r))},[c]),T=a.useCallback((e,t)=>{c&&d(r=>r.map(i=>i.id===c?{...i,fields:{...i.fields,[e]:t},updatedAt:f()}:i))},[c]),D=a.useCallback(e=>{d(t=>t.filter(r=>r.id!==e)),k(t=>t.filter(r=>r.source!==e&&r.target!==e)),g(t=>t===e?null:t)},[]),y=o.find(e=>e.id===c)??o[0]??null,v=y?R.get(y.templateId)??null:null,A=v?We[v.id]:null;if(B===0)return n.jsx(w,{feature:"brainstorm",center:n.jsxs("div",{className:"grid h-full place-content-center gap-2 text-center text-[#d4d8e1]",children:[n.jsx("h2",{children:"No brainstorm sessions yet"}),n.jsx("p",{children:"Use the selector next to Brainstorm in the top nav to create your first session."})]})});if(!m)return n.jsx(w,{feature:"brainstorm",center:n.jsxs("div",{className:"grid h-full place-content-center gap-2 text-center text-[#d4d8e1]",children:[n.jsx("h2",{children:"No session selected"}),n.jsx("p",{children:"Select a brainstorm session from the top nav dropdown."})]})});if(L)return n.jsx(w,{feature:"brainstorm",center:n.jsx("div",{className:"grid h-full place-content-center text-center text-[#a8a8a8]",children:n.jsx("p",{children:"Loading brainstorm..."})})});const H=n.jsxs("div",{className:"flex h-full min-h-0 flex-col gap-4 overflow-hidden",children:[n.jsxs("div",{children:[n.jsx("h3",{className:"mb-3 text-[11px] font-semibold uppercase tracking-widest text-[#666]",children:"Templates"}),n.jsx("div",{className:"grid max-h-[45%] gap-1.5 overflow-y-auto pr-1 custom-scrollbar",children:E.map(e=>n.jsxs("button",{type:"button",className:"group flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left transition-all hover:border-[#2a2a2a] hover:bg-[#1a1a1a]",onClick:()=>_(e.id),children:[n.jsx("span",{className:"shrink-0 text-[16px]",children:e.icon}),n.jsx("div",{className:"min-w-0 flex-1",children:n.jsx("div",{className:"truncate text-[12px] font-medium text-[#d0d0d0]",children:e.name})}),n.jsx(ue,{size:13,className:"shrink-0 text-[#555] opacity-0 transition-opacity group-hover:opacity-100"})]},e.id))})]}),o.length>0?n.jsxs("div",{className:"flex min-h-0 flex-1 flex-col overflow-hidden",children:[n.jsxs("h3",{className:"mb-3 shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[#666]",children:["Entries (",o.length,")"]}),n.jsx("div",{className:"grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1 custom-scrollbar",children:o.map(e=>{const t=R.get(e.templateId),r=e.id===y?.id;return n.jsxs("div",{className:`group flex items-center gap-1.5 rounded-xl border p-1 transition-all ${r?"border-[#2a2a2a] bg-gradient-to-r from-[#1c1c1c] to-[#121212]":"border-transparent hover:bg-[#161616]"}`,children:[n.jsxs("button",{type:"button",className:"flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",onClick:()=>g(e.id),children:[n.jsx("span",{className:"shrink-0 text-[14px]",children:t?.icon??"📝"}),n.jsx("span",{className:`flex-1 truncate text-[12px] font-medium ${r?"text-[#fff]":"text-[#9fa3ad]"}`,children:e.name})]}),n.jsx("button",{type:"button",className:"rounded-md p-1 opacity-0 transition-all hover:bg-[#2a2a2a] group-hover:opacity-100",onClick:()=>{window.confirm(`Delete "${e.name}"?`)&&D(e.id)},children:n.jsx(ce,{size:12,className:"text-[#888] hover:text-red-400"})})]},e.id)})})]}):null]}),K=y&&v?n.jsx("div",{className:"h-full min-h-0 overflow-y-auto custom-scrollbar",children:A?n.jsx(A,{entry:y,template:v,onUpdateName:W,onUpdateField:T}):n.jsx(de,{entry:y,template:v,onUpdateName:W,onUpdateField:T,style:{mode:"orbit",accent:"#6366f1",panel:"#1f2434",glow:"rgba(99,102,241,.3)"}})}):n.jsxs("div",{className:"grid h-full place-content-center gap-3 text-center",children:[n.jsx("div",{className:"text-[40px]",children:"🧠"}),n.jsx("h2",{className:"text-[16px] font-medium text-[#d4d8e1]",children:o.length===0?"Start your visual brainstorm":"Select an entry"}),n.jsx("p",{className:"max-w-[320px] text-[13px] text-[#777]",children:o.length===0?"Pick a template from the left panel. Each entry opens as a graphical framework poster.":"Choose an entry from the left panel to open its visual template."})]});return n.jsx(w,{feature:"brainstorm",left:H,center:K})}M.__docgenInfo={description:"",methods:[],displayName:"BrainstormWorkspace",props:{workspaceId:{required:!0,tsType:{name:"string"},description:""},runtime:{required:!0,tsType:{name:"signature",type:"object",raw:`{
  auth: {
    getLocalAuthState(): RuntimeResult<LocalAuthState>;
    generateMnemonic(): RuntimeResult<AuthMnemonic>;
    registerLocalMnemonic(args: {
      displayName: string;
      mnemonicPhrase: string;
      inviteToken?: string;
    }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
    unlockWithMnemonic(args: {
      mnemonicPhrase: string;
      inviteToken?: string;
    }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
    forgotResetLocal(): Promise<{ error: { message: string } | null }>;
    tryAutoUnlock(): RuntimeResult<{ session: RuntimeSession | null }>;
    setPin(pin: string): Promise<{ error: { message: string } | null }>;
    unlockWithPin(pin: string): RuntimeResult<{ session: RuntimeSession | null }>;
    removePin(): Promise<{ error: { message: string } | null }>;
    updateDisplayName(displayName: string): RuntimeResult<{ displayName: string }>;
    getStoredMnemonic(): RuntimeResult<{ phrase: string | null }>;
    getSession(): RuntimeResult<{ session: RuntimeSession | null }>;
    refreshSession(): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
    onAuthStateChange(cb: AuthListener): { data: { subscription: { unsubscribe(): void } } };
    signOut(): Promise<{ error: { message: string } | null }>;
  };
  workspace: {
    list(): Promise<any[]>;
    create(name: string): Promise<any>;
    rename(workspaceId: string, name: string): Promise<any>;
    leave(workspaceId: string): Promise<void>;
    softDelete(workspaceId: string): Promise<void>;
    issueInvite(
      workspaceId: string,
      email: string,
      role: string,
      modulePermissions?: { notes?: string; tasks?: string }
    ): Promise<any>;
    joinInvite(token: string): Promise<any>;
    listMembers(workspaceId: string): Promise<any[]>;
    listInvites(workspaceId: string): Promise<any[]>;
    updateInvite(
      inviteId: string,
      role: string,
      modulePermissions?: { notes?: string; tasks?: string }
    ): Promise<void>;
    revokeInvite(inviteId: string): Promise<void>;
    updateMemberPermissions(
      memberId: string,
      role: string,
      modulePermissions?: { notes?: string; tasks?: string }
    ): Promise<void>;
    listNotifications(): Promise<any[]>;
    markNotificationRead(notificationId: string): Promise<void>;
    markAllNotificationsRead(): Promise<void>;
  };
  notes: {
    list(workspaceId: string): Promise<any[]>;
    upsert(note: any): Promise<any>;
    move(input: {
      workspaceId: string;
      noteId: string;
      newParentId: string | null;
      newPosition: string;
    }): Promise<any>;
    remove(input: { workspaceId: string; noteId: string; deletedAt?: string }): Promise<any>;
    getDocState(workspaceId: string, noteId: string): Promise<any>;
    applyCrdtUpdates(
      workspaceId: string,
      noteId: string,
      clientId: string,
      updates: Array<{ idempotencyKey?: string; clientSeq: number; updateB64: string }>
    ): Promise<any>;
    subscribeLocal(workspaceId: string, noteId?: string | null): Promise<string>;
  };
  tasks: {
    list(workspaceId: string): Promise<any>;
    upsert(input: { project?: any; workflowState?: any; task?: any }): Promise<any>;
    upsertProject(project: any): Promise<any>;
    upsertState(workflowState: any): Promise<any>;
    upsertItem(task: any): Promise<any>;
    move(input: {
      workspaceId: string;
      taskId: string;
      newParentTaskId: string | null;
      newStateId: string;
      newPosition: string;
    }): Promise<any>;
    deleteItem(input: { workspaceId: string; taskId: string; deletedAt?: string }): Promise<any>;
    addComment(comment: any): Promise<any>;
    upsertComment(comment: any): Promise<any>;
    deleteComment(commentId: string): Promise<void>;
    subscribeLocal(workspaceId: string): Promise<string>;
  };
  graph: {
    upsertNodesEdges(request: any): Promise<void>;
    queryRelated(workspaceId: string, nodeId: string, limit?: number): Promise<any>;
    queryHybrid(query: any): Promise<any[]>;
    getFullGraph(workspaceId: string): Promise<any>;
  };
  p2p: {
    start(): Promise<void>;
    peerStatus(): Promise<any>;
    syncNow(workspaceId: string): Promise<any>;
  };
  migration: {
    importLegacy(payload: any): Promise<any>;
  };
  localStore: {
    get(namespace: string, key: string): Promise<any>;
    set(namespace: string, key: string, value: unknown): Promise<void>;
    remove(namespace: string, key: string): Promise<void>;
  };
  ai: {
    listCredentials(): Promise<AiCredentialSummary[]>;
    saveCredential(input: { apiKey: string; model: string }): Promise<AiCredentialSummary>;
    deleteCredential(id: string): Promise<void>;
    getCredential(id: string): Promise<AiCredentialResolved>;
  };
  timetracking: {
    list(workspaceId: string): Promise<any>;
    upsertEntry(entry: any): Promise<any>;
    deleteEntry(entryId: string): Promise<void>;
    upsertCategory(category: any): Promise<any>;
    deleteCategory(categoryId: string): Promise<void>;
    upsertRule(rule: any): Promise<any>;
    deleteRule(ruleId: string): Promise<void>;
    upsertProject(project: any): Promise<any>;
    deleteProject(projectId: string): Promise<void>;
    upsertFocusSession(session: any): Promise<any>;
    getActiveWindow(): Promise<any>;
    startTracking(workspaceId: string): Promise<void>;
    stopTracking(): Promise<void>;
    getTrackingStatus(): Promise<{ isTracking: boolean }>;
  };
  email: {
    listAccounts(): Promise<any[]>;
    connectAndSave(input: any): Promise<any>;
    disconnect(accountId: string): Promise<void>;
    listEnvelopes(input: {
      accountId?: string | null;
      folder: string;
      limit?: number;
      forceSync?: boolean;
    }): Promise<any>;
    getMessageBody(input: { accountId: string; folder: string; uid: number }): Promise<any>;
    prefetchBodies(input: {
      accountId: string;
      folder: string;
      uids: number[];
      limit?: number;
    }): Promise<any>;
    syncNow(input: { accountId?: string | null; folder?: string | null }): Promise<any>;
    setActivityState(input: {
      mode: "mailForeground" | "appForegroundNonMail" | "appBackground";
      activeAccountId?: string | null;
      activeFolder?: string | null;
    }): Promise<void>;
    applyFlag(input: {
      accountId: string;
      folder: string;
      uid: number;
      flag: "seen" | "starred";
      value: boolean;
    }): Promise<any>;
    getMailboxStatus(input?: { accountId?: string | null }): Promise<any[]>;
    sendSaved(input: {
      accountId: string;
      to: string;
      subject: string;
      body: string;
    }): Promise<boolean>;
  };
}`,signature:{properties:[{key:"auth",value:{name:"signature",type:"object",raw:`{
  getLocalAuthState(): RuntimeResult<LocalAuthState>;
  generateMnemonic(): RuntimeResult<AuthMnemonic>;
  registerLocalMnemonic(args: {
    displayName: string;
    mnemonicPhrase: string;
    inviteToken?: string;
  }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
  unlockWithMnemonic(args: {
    mnemonicPhrase: string;
    inviteToken?: string;
  }): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
  forgotResetLocal(): Promise<{ error: { message: string } | null }>;
  tryAutoUnlock(): RuntimeResult<{ session: RuntimeSession | null }>;
  setPin(pin: string): Promise<{ error: { message: string } | null }>;
  unlockWithPin(pin: string): RuntimeResult<{ session: RuntimeSession | null }>;
  removePin(): Promise<{ error: { message: string } | null }>;
  updateDisplayName(displayName: string): RuntimeResult<{ displayName: string }>;
  getStoredMnemonic(): RuntimeResult<{ phrase: string | null }>;
  getSession(): RuntimeResult<{ session: RuntimeSession | null }>;
  refreshSession(): RuntimeResult<{ user: RuntimeSession["user"] | null; session: RuntimeSession | null }>;
  onAuthStateChange(cb: AuthListener): { data: { subscription: { unsubscribe(): void } } };
  signOut(): Promise<{ error: { message: string } | null }>;
}`,signature:{properties:[{key:"getLocalAuthState",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"generateMnemonic",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"registerLocalMnemonic",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"unlockWithMnemonic",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"forgotResetLocal",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ error: { message: string } | null }",signature:{properties:[{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ error: { message: string } | null }>",required:!0}},{key:"tryAutoUnlock",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"setPin",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ error: { message: string } | null }",signature:{properties:[{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ error: { message: string } | null }>",required:!0}},{key:"unlockWithPin",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"removePin",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ error: { message: string } | null }",signature:{properties:[{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ error: { message: string } | null }>",required:!0}},{key:"updateDisplayName",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"getStoredMnemonic",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"getSession",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"refreshSession",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ data: T; error: { message: string } | null }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:`{
  profileExists: boolean;
  displayName: string | null;
  userId: string | null;
  hasPin: boolean;
  hasKeychainMnemonic: boolean;
}`,signature:{properties:[{key:"profileExists",value:{name:"boolean",required:!0}},{key:"displayName",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"userId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"hasPin",value:{name:"boolean",required:!0}},{key:"hasKeychainMnemonic",value:{name:"boolean",required:!0}}]},required:!0}},{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ data: T; error: { message: string } | null }>",required:!0}},{key:"onAuthStateChange",value:{name:"signature",type:"object",raw:"{ data: { subscription: { unsubscribe(): void } } }",signature:{properties:[{key:"data",value:{name:"signature",type:"object",raw:"{ subscription: { unsubscribe(): void } }",signature:{properties:[{key:"subscription",value:{name:"signature",type:"object",raw:"{ unsubscribe(): void }",signature:{properties:[{key:"unsubscribe",value:{name:"void",required:!0}}]},required:!0}}]},required:!0}}]},required:!0}},{key:"signOut",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ error: { message: string } | null }",signature:{properties:[{key:"error",value:{name:"union",raw:"{ message: string } | null",elements:[{name:"signature",type:"object",raw:"{ message: string }",signature:{properties:[{key:"message",value:{name:"string",required:!0}}]}},{name:"null"}],required:!0}}]}}],raw:"Promise<{ error: { message: string } | null }>",required:!0}}]},required:!0}},{key:"workspace",value:{name:"signature",type:"object",raw:`{
  list(): Promise<any[]>;
  create(name: string): Promise<any>;
  rename(workspaceId: string, name: string): Promise<any>;
  leave(workspaceId: string): Promise<void>;
  softDelete(workspaceId: string): Promise<void>;
  issueInvite(
    workspaceId: string,
    email: string,
    role: string,
    modulePermissions?: { notes?: string; tasks?: string }
  ): Promise<any>;
  joinInvite(token: string): Promise<any>;
  listMembers(workspaceId: string): Promise<any[]>;
  listInvites(workspaceId: string): Promise<any[]>;
  updateInvite(
    inviteId: string,
    role: string,
    modulePermissions?: { notes?: string; tasks?: string }
  ): Promise<void>;
  revokeInvite(inviteId: string): Promise<void>;
  updateMemberPermissions(
    memberId: string,
    role: string,
    modulePermissions?: { notes?: string; tasks?: string }
  ): Promise<void>;
  listNotifications(): Promise<any[]>;
  markNotificationRead(notificationId: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
}`,signature:{properties:[{key:"list",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"create",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"rename",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"leave",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"softDelete",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"issueInvite",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"joinInvite",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"listMembers",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"listInvites",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"updateInvite",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"revokeInvite",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"updateMemberPermissions",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"listNotifications",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"markNotificationRead",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"markAllNotificationsRead",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}}]},required:!0}},{key:"notes",value:{name:"signature",type:"object",raw:`{
  list(workspaceId: string): Promise<any[]>;
  upsert(note: any): Promise<any>;
  move(input: {
    workspaceId: string;
    noteId: string;
    newParentId: string | null;
    newPosition: string;
  }): Promise<any>;
  remove(input: { workspaceId: string; noteId: string; deletedAt?: string }): Promise<any>;
  getDocState(workspaceId: string, noteId: string): Promise<any>;
  applyCrdtUpdates(
    workspaceId: string,
    noteId: string,
    clientId: string,
    updates: Array<{ idempotencyKey?: string; clientSeq: number; updateB64: string }>
  ): Promise<any>;
  subscribeLocal(workspaceId: string, noteId?: string | null): Promise<string>;
}`,signature:{properties:[{key:"list",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"upsert",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"move",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"remove",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getDocState",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"applyCrdtUpdates",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"subscribeLocal",value:{name:"Promise",elements:[{name:"string"}],raw:"Promise<string>",required:!0}}]},required:!0}},{key:"tasks",value:{name:"signature",type:"object",raw:`{
  list(workspaceId: string): Promise<any>;
  upsert(input: { project?: any; workflowState?: any; task?: any }): Promise<any>;
  upsertProject(project: any): Promise<any>;
  upsertState(workflowState: any): Promise<any>;
  upsertItem(task: any): Promise<any>;
  move(input: {
    workspaceId: string;
    taskId: string;
    newParentTaskId: string | null;
    newStateId: string;
    newPosition: string;
  }): Promise<any>;
  deleteItem(input: { workspaceId: string; taskId: string; deletedAt?: string }): Promise<any>;
  addComment(comment: any): Promise<any>;
  upsertComment(comment: any): Promise<any>;
  deleteComment(commentId: string): Promise<void>;
  subscribeLocal(workspaceId: string): Promise<string>;
}`,signature:{properties:[{key:"list",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"upsert",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"upsertProject",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"upsertState",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"upsertItem",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"move",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"deleteItem",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"addComment",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"upsertComment",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"deleteComment",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"subscribeLocal",value:{name:"Promise",elements:[{name:"string"}],raw:"Promise<string>",required:!0}}]},required:!0}},{key:"graph",value:{name:"signature",type:"object",raw:`{
  upsertNodesEdges(request: any): Promise<void>;
  queryRelated(workspaceId: string, nodeId: string, limit?: number): Promise<any>;
  queryHybrid(query: any): Promise<any[]>;
  getFullGraph(workspaceId: string): Promise<any>;
}`,signature:{properties:[{key:"upsertNodesEdges",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"queryRelated",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"queryHybrid",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"getFullGraph",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}}]},required:!0}},{key:"p2p",value:{name:"signature",type:"object",raw:`{
  start(): Promise<void>;
  peerStatus(): Promise<any>;
  syncNow(workspaceId: string): Promise<any>;
}`,signature:{properties:[{key:"start",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"peerStatus",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"syncNow",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}}]},required:!0}},{key:"migration",value:{name:"signature",type:"object",raw:`{
  importLegacy(payload: any): Promise<any>;
}`,signature:{properties:[{key:"importLegacy",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}}]},required:!0}},{key:"localStore",value:{name:"signature",type:"object",raw:`{
  get(namespace: string, key: string): Promise<any>;
  set(namespace: string, key: string, value: unknown): Promise<void>;
  remove(namespace: string, key: string): Promise<void>;
}`,signature:{properties:[{key:"get",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"set",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"remove",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}}]},required:!0}},{key:"ai",value:{name:"signature",type:"object",raw:`{
  listCredentials(): Promise<AiCredentialSummary[]>;
  saveCredential(input: { apiKey: string; model: string }): Promise<AiCredentialSummary>;
  deleteCredential(id: string): Promise<void>;
  getCredential(id: string): Promise<AiCredentialResolved>;
}`,signature:{properties:[{key:"listCredentials",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  model: string;
  keyPreview: string;
  createdAt: string;
  updatedAt: string;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"model",value:{name:"string",required:!0}},{key:"keyPreview",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}}]}}],raw:"AiCredentialSummary[]"}],raw:"Promise<AiCredentialSummary[]>",required:!0}},{key:"saveCredential",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  model: string;
  keyPreview: string;
  createdAt: string;
  updatedAt: string;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"model",value:{name:"string",required:!0}},{key:"keyPreview",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}}]}}],raw:"Promise<AiCredentialSummary>",required:!0}},{key:"deleteCredential",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"getCredential",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  model: string;
  apiKey: string;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"model",value:{name:"string",required:!0}},{key:"apiKey",value:{name:"string",required:!0}}]}}],raw:"Promise<AiCredentialResolved>",required:!0}}]},required:!0}},{key:"timetracking",value:{name:"signature",type:"object",raw:`{
  list(workspaceId: string): Promise<any>;
  upsertEntry(entry: any): Promise<any>;
  deleteEntry(entryId: string): Promise<void>;
  upsertCategory(category: any): Promise<any>;
  deleteCategory(categoryId: string): Promise<void>;
  upsertRule(rule: any): Promise<any>;
  deleteRule(ruleId: string): Promise<void>;
  upsertProject(project: any): Promise<any>;
  deleteProject(projectId: string): Promise<void>;
  upsertFocusSession(session: any): Promise<any>;
  getActiveWindow(): Promise<any>;
  startTracking(workspaceId: string): Promise<void>;
  stopTracking(): Promise<void>;
  getTrackingStatus(): Promise<{ isTracking: boolean }>;
}`,signature:{properties:[{key:"list",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"upsertEntry",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"deleteEntry",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"upsertCategory",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"deleteCategory",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"upsertRule",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"deleteRule",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"upsertProject",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"deleteProject",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"upsertFocusSession",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getActiveWindow",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"startTracking",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"stopTracking",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"getTrackingStatus",value:{name:"Promise",elements:[{name:"signature",type:"object",raw:"{ isTracking: boolean }",signature:{properties:[{key:"isTracking",value:{name:"boolean",required:!0}}]}}],raw:"Promise<{ isTracking: boolean }>",required:!0}}]},required:!0}},{key:"email",value:{name:"signature",type:"object",raw:`{
  listAccounts(): Promise<any[]>;
  connectAndSave(input: any): Promise<any>;
  disconnect(accountId: string): Promise<void>;
  listEnvelopes(input: {
    accountId?: string | null;
    folder: string;
    limit?: number;
    forceSync?: boolean;
  }): Promise<any>;
  getMessageBody(input: { accountId: string; folder: string; uid: number }): Promise<any>;
  prefetchBodies(input: {
    accountId: string;
    folder: string;
    uids: number[];
    limit?: number;
  }): Promise<any>;
  syncNow(input: { accountId?: string | null; folder?: string | null }): Promise<any>;
  setActivityState(input: {
    mode: "mailForeground" | "appForegroundNonMail" | "appBackground";
    activeAccountId?: string | null;
    activeFolder?: string | null;
  }): Promise<void>;
  applyFlag(input: {
    accountId: string;
    folder: string;
    uid: number;
    flag: "seen" | "starred";
    value: boolean;
  }): Promise<any>;
  getMailboxStatus(input?: { accountId?: string | null }): Promise<any[]>;
  sendSaved(input: {
    accountId: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<boolean>;
}`,signature:{properties:[{key:"listAccounts",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"connectAndSave",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"disconnect",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"listEnvelopes",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getMessageBody",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"prefetchBodies",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"syncNow",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"setActivityState",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"applyFlag",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getMailboxStatus",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"sendSaved",value:{name:"Promise",elements:[{name:"boolean"}],raw:"Promise<boolean>",required:!0}}]},required:!0}}]}},description:""}}};const sn={title:"features/brainstorm/ui/brainstorm-workspace",component:M,tags:["autodocs"]},q={args:{}};q.parameters={...q.parameters,docs:{...q.parameters?.docs,source:{originalSource:`{
  args: {}
}`,...q.parameters?.docs?.source}}};const on=["Primary"];export{q as Primary,on as __namedExportsOrder,sn as default};
