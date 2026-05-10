import{j as h}from"./jsx-runtime-u17CrQMm.js";import{r as o}from"./index-B3d2A58Q.js";import{R as Be,u as Ue,a as Je,b as Ge,r as Xe,i as Ye}from"./index-BNAAxidF.js";import{F as Ze}from"./feature-panels-shell-BdfMhs37.js";import{d as be,M as Ve,T as Qe}from"./custom-node-B2RL6MLS.js";import{M as en}from"./mindmap-mini-map-Caa0c936.js";import{M as nn}from"./mindmap-toolbar-CaWzZdpb.js";import{M as tn}from"./mindmap-relations-CFnRTyih.js";import{M as Oe}from"./layout-events-34Yly2Us.js";import{listMindmaps as rn,readStoredActiveMindmap as $e,saveMindmapDocument as an,loadMindmapDocument as sn}from"./mindmap-storage-CWNw3rze.js";import{r as on,d as ln}from"./panel-events-BeJSmLTW.js";import{n as un}from"./node-icons-BMRM_Bs8.js";/* empty css              */import"./with-selector-FtjiAAQg.js";import"./index-BEwfMeI6.js";import"./index-AOmQ1fUN.js";import"./createLucideIcon-CVEjH9DW.js";import"./x-mvR0woP4.js";import"./lock-BWyN6z6d.js";import"./tag-LDmvB8Ep.js";function mn(){const l=o.useRef([]),q=o.useRef([]),p=o.useCallback((K,b)=>{const E={nodes:JSON.parse(JSON.stringify(K)),edges:JSON.parse(JSON.stringify(b))};l.current=[...l.current.slice(-50),E],q.current=[]},[]),P=o.useCallback((K,b)=>{const E=l.current;if(E.length===0)return null;const O=E[E.length-1];l.current=E.slice(0,-1);const D={nodes:JSON.parse(JSON.stringify(K)),edges:JSON.parse(JSON.stringify(b))};return q.current=[D,...q.current],O},[]),y=o.useCallback((K,b)=>{const E=q.current;if(E.length===0)return null;const O=E[0];q.current=E.slice(1);const D={nodes:JSON.parse(JSON.stringify(K)),edges:JSON.parse(JSON.stringify(b))};return l.current=[...l.current,D],O},[]),C=o.useCallback(()=>{l.current=[],q.current=[]},[]),m=o.useCallback(()=>l.current.length>0,[]),N=o.useCallback(()=>q.current.length>0,[]);return o.useMemo(()=>({pushSnapshot:p,undo:P,redo:y,clear:C,canUndo:m,canRedo:N}),[p,P,y,C,m,N])}const dn={mindmap:Ve},cn=Qe[4],Z="#ffffff",xe=2,gn=[{value:"bezier",icon:"∿",label:"Bezier"},{value:"straight",icon:"⎯",label:"Straight"},{value:"step",icon:"┐",label:"Step"},{value:"smoothstep",icon:"≈",label:"Smooth"}];function pn(l){return l==="straight"||l==="step"||l==="smoothstep"?l:"bezier"}function We(l){return l==="bezier"?"default":l}function me(l,q){const p=typeof l.data?.color=="string"?l.data.color:String(l.style?.stroke??q),P=Number(l.data?.thickness??l.style?.strokeWidth??xe),y=Number.isFinite(P)&&P>0?P:xe,C=typeof l.data?.label=="string"?l.data.label:typeof l.label=="string"?l.label:"",m=l.data?.style,N=m==="bezier"||m==="straight"||m==="step"||m==="smoothstep"?m:pn(l.type),K=l.style?.strokeDasharray,b=K==="7 6"?"dashed":K==="1 10"?"dotted":"solid",E=l.data?.pattern;return{label:C,style:N,pattern:E==="solid"||E==="dashed"||E==="dotted"?E:b,color:p,animated:l.data?.animated??l.animated??!0,thickness:y}}function ve(l){if(l==="dashed")return"7 6";if(l==="dotted")return"1 10"}function yn(l){if(l==="solid")return"mindmap-edge-solid-animated";if(l==="dashed")return"mindmap-edge-dashed";if(l==="dotted")return"mindmap-edge-dotted"}function de(l,q){return`${yn(l)??""}${q?"":" mindmap-edge-no-anim"}`.trim()}function Fe(l){const q=l.trim();return/^#([0-9a-fA-F]{6})$/.test(q)?q.toLowerCase():null}function fn(l){function q(t){const s={};for(const u of t.split(",")){const[d,c]=u.split(":");if(!d||!c)continue;const S=d.trim().toLowerCase(),x=c.trim();S==="fill"&&(s.bg=x),S==="stroke"&&(s.border=x),S==="color"&&(s.text=x)}return s}function p(t){const s=t.trim();return s?s.startsWith('"')&&s.endsWith('"')||s.startsWith("'")&&s.endsWith("'")?s.slice(1,-1).replace(/\\"/g,'"').replace(/\\n/g,`
`):s.replace(/\\n/g,`
`):""}function P(t){const s=t.trim(),u=s.match(/^([A-Za-z][\w-]*)/);if(!u)return null;const d=u[1],c=s.match(/:::\s*([A-Za-z][\w-]*)\s*$/);let x=s.match(/"([\s\S]*?)"/)?.[1];return typeof x=="string"&&(x=x.replace(/\\"/g,'"').replace(/\\n/g,`
`)),{id:d,label:x,className:c?.[1]}}function y(t,s,u){const d=t.get(s)??{};t.set(s,{label:u.label??d.label,className:u.className??d.className,style:{...d.style??{},...u.style??{}}})}const C=l.split(/\r?\n/).map(t=>t.trim()).filter(t=>t.length>0&&!t.startsWith("%%")),m=new Set,N=new Map,K=new Map,b=[],E=new Map;let O=null;const D=(t,s)=>{m.add(t),s&&y(N,t,s),O&&E.set(t,O)};for(const t of C){if(t.startsWith("graph ")||t.startsWith("flowchart ")||t.startsWith("direction ")||t.startsWith("linkStyle "))continue;if(t.startsWith("subgraph ")){O=t.match(/^subgraph\s+([A-Za-z][\w-]*)/)?.[1]??"subgraph";continue}if(t==="end"){O=null;continue}const s=t.match(/^classDef\s+([A-Za-z][\w-]*)\s+(.+)$/);if(s){K.set(s[1],q(s[2]));continue}const u=t.match(/^class\s+(.+)\s+([A-Za-z][\w-]*)$/);if(u){const g=u[1].split(",").map($=>$.trim()).filter(Boolean),k=u[2];for(const $ of g)D($,{className:k});continue}const d=t.match(/^style\s+([A-Za-z][\w-]*)\s+(.+)$/);if(d){const g=d[1];D(g,{style:q(d[2])});continue}const c=t.match(/^(.*?)\s*-->\|([^|]*)\|\s*(.+)$/);if(c){const g=P(c[1]),k=P(c[3]);if(!g||!k)continue;D(g.id,{label:g.label,className:g.className}),D(k.id,{label:k.label,className:k.className}),b.push({source:g.id,target:k.id,label:p(c[2])});continue}const S=t.match(/^(.*?)\s*--\s*(.*?)\s*-->\s*(.+)$/);if(S){const g=P(S[1]),k=P(S[3]);if(!g||!k)continue;D(g.id,{label:g.label,className:g.className}),D(k.id,{label:k.label,className:k.className}),b.push({source:g.id,target:k.id,label:p(S[2])});continue}const x=t.match(/^(.*?)\s*-->\s*(.+)$/);if(x){const g=P(x[1]),k=P(x[2]);if(!g||!k)continue;D(g.id,{label:g.label,className:g.className}),D(k.id,{label:k.label,className:k.className}),b.push({source:g.id,target:k.id,label:""});continue}const R=P(t);R&&D(R.id,{label:R.label,className:R.className})}if(m.size===0)throw new Error('No Mermaid nodes found. Expected lines like A["Label"] and A --> B.');const j=Array.from(m),V=new Map,ne=new Map;for(const t of j)V.set(t,[]),ne.set(t,[]);for(const t of b)V.has(t.source)||V.set(t.source,[]),ne.has(t.target)||ne.set(t.target,[]),V.get(t.source).push(t.target),ne.get(t.target).push(t.source);const W=(t,s)=>{if(t===s)return!0;const u=new Set,d=[t];for(;d.length>0;){const c=d.pop();if(c===s)return!0;if(u.has(c))continue;u.add(c);const S=V.get(c)??[];for(const x of S)u.has(x)||d.push(x)}return!1},H=b.filter(t=>t.source!==t.target&&!W(t.target,t.source)),re=new Map,Q=new Map(j.map(t=>[t,0]));for(const t of j)re.set(t,[]);for(const t of H)re.get(t.source).push(t.target),Q.set(t.target,(Q.get(t.target)??0)+1);const U=j.filter(t=>(Q.get(t)??0)===0);U.length===0&&j.length>0&&U.push(j[0]);const se=[...U],ce=[],he=new Map(Q);for(;se.length>0;){const t=se.shift();ce.push(t);for(const s of re.get(t)??[])he.set(s,(he.get(s)??0)-1),(he.get(s)??0)<=0&&se.push(s)}for(const t of j)ce.includes(t)||ce.push(t);const ie=new Map(j.map(t=>[t,0]));for(const t of U)ie.set(t,0);for(const t of ce){const s=ie.get(t)??0;for(const u of re.get(t)??[])ie.set(u,Math.max(ie.get(u)??0,s+1))}const we=t=>{const s=t.toUpperCase(),u=E.get(t);return typeof u=="string"&&/storage/i.test(u)||s.startsWith("ST_")||s==="STORAGE"?"storage":s.startsWith("CS")||s==="APPSTART"||s==="APPEND"?"cold":s.startsWith("IL_")||s==="IDLE_LOOP"?"idle":s.startsWith("RC_")||s==="RECONN"||s.startsWith("OL_")||s==="POLL_LOOP"?"reconnect":s.startsWith("UA_")||s==="UA_TRIGGER"?"user":"misc"},Y=new Map;for(const t of j)Y.set(t,we(t));for(let t=0;t<3;t+=1)for(const s of j){if(Y.get(s)!=="misc")continue;const d=[...ne.get(s)??[],...V.get(s)??[]].map(c=>Y.get(c)).find(c=>c&&c!=="misc");d&&d!=="misc"&&Y.set(s,d)}const J={storage:-860,cold:-260,idle:760,reconnect:1700,user:620,misc:2500},ge={storage:0,cold:300,idle:280,reconnect:300,user:280,misc:300},z=new Map,M=new Map,pe=t=>{const d=(N.get(t)?.label??t).replace(/<br\/>/g,`
`).split(/\n+/).map(R=>R.trim()),c=d.reduce((R,g)=>Math.max(R,g.length),0),S=Math.max(190,Math.min(460,c*7.2+72)),x=Math.max(78,Math.min(240,d.length*18+54));return{width:S,height:x}};for(const t of j)M.set(t,pe(t));const ae=j.filter(t=>Y.get(t)==="storage").sort((t,s)=>t.localeCompare(s)),Se=88;let qe=-(ae.reduce((t,s)=>t+(M.get(s)?.width??260),0)+Math.max(0,ae.length-1)*Se)/2;for(const t of ae){const s=M.get(t)?.width??260;z.set(t,{x:qe+s/2,y:J.storage}),qe+=s+Se,ie.set(t,0)}const Re={cold:["APPSTART","CS1"],idle:["IDLE_LOOP","IL_WAIT"],reconnect:["RECONN"],user:["UA_TRIGGER","UA_WHICH"]},Le=["cold","idle","reconnect","user","misc"],Te=["user","idle","cold","reconnect","misc"],ke=new Map,B=new Map;for(const t of Le){const s=j.filter(e=>Y.get(e)===t);if(s.length===0)continue;const u=new Set(s),d=new Map,c=new Map;for(const e of s)d.set(e,(re.get(e)??[]).filter(r=>u.has(r))),c.set(e,(ne.get(e)??[]).filter(r=>u.has(r)));const S=(Re[t]??[]).filter(e=>u.has(e)),x=s.filter(e=>(c.get(e)?.length??0)===0),R=S.length>0?S:x.length>0?x:[s[0]],g=new Map,k=[...R];for(const e of R)g.set(e,0);for(;k.length>0;){const e=k.shift(),r=g.get(e)??0;for(const a of d.get(e)??[]){const i=g.get(a);(i===void 0||i<r+1)&&(g.set(a,r+1),k.push(a))}}let $=Math.max(0,...Array.from(g.values()));for(const e of s)g.has(e)||($+=1,g.set(e,$));const L=new Map;for(const e of s){const r=g.get(e)??0;L.has(r)||L.set(r,[]),L.get(r).push(e)}const F=Array.from(L.keys()).sort((e,r)=>e-r),ee=new Map;for(const e of F)ee.set(e,[...L.get(e)??[]].sort((r,a)=>r.localeCompare(a)));const Ce=(e,r)=>(ee.get(e)??[]).indexOf(r);for(let e=0;e<3;e+=1){for(let r=1;r<F.length;r+=1){const a=F[r],i=F[r-1],I=(ee.get(a)??[]).map((f,v)=>{const G=(c.get(f)??[]).filter(w=>(g.get(w)??0)===i),fe=G.length===0?v:G.reduce((w,_)=>w+Math.max(0,Ce(i,_)),0)/G.length;return{id:f,score:fe,j:v}});I.sort((f,v)=>f.score-v.score||f.j-v.j),ee.set(a,I.map(f=>f.id))}for(let r=F.length-2;r>=0;r-=1){const a=F[r],i=F[r+1],I=(ee.get(a)??[]).map((f,v)=>{const G=(d.get(f)??[]).filter(w=>(g.get(w)??0)===i),fe=G.length===0?v:G.reduce((w,_)=>w+Math.max(0,Ce(i,_)),0)/G.length;return{id:f,score:fe,j:v}});I.sort((f,v)=>f.score-v.score||f.j-v.j),ee.set(a,I.map(f=>f.id))}}const le=92;let n=0;for(const e of F){const r=ee.get(e)??[],i=r.reduce((T,I)=>T+(M.get(I)?.width??260),0)+Math.max(0,r.length-1)*le;i>n&&(n=i)}ke.set(t,{sortedLevels:F,orderByLevel:ee}),B.set(t,Math.max(520,n+120))}const ye=Te.filter(t=>ke.has(t)),Pe=980;let Ne=-(ye.reduce((t,s)=>t+(B.get(s)??600),0)+Math.max(0,ye.length-1)*Pe)/2;const Ie=new Map;for(const t of ye){const s=B.get(t)??600;Ie.set(t,Ne+s/2),Ne+=s+Pe}for(const t of ye){const s=Ie.get(t)??0,u=ke.get(t);if(u)for(const d of u.sortedLevels){const c=u.orderByLevel.get(d)??[],x=c.reduce((g,k)=>g+(M.get(k)?.width??260),0)+Math.max(0,c.length-1)*92;let R=s-x/2;for(const g of c){const k=M.get(g)?.width??260;z.set(g,{x:R+k/2,y:J[t]+d*ge[t]}),R+=k+92}}}const oe=t=>{const s=z.get(t)??{x:0,y:0},u=M.get(t)??{width:260,height:90},d=72,c=52;return{l:s.x-u.width/2-d,r:s.x+u.width/2+d,t:s.y-u.height/2-c,b:s.y+u.height/2+c}},A=j.filter(t=>Y.get(t)!=="storage");for(let t=0;t<10;t+=1)for(let s=0;s<A.length;s+=1){const u=A[s],d=z.get(u),c=oe(u);for(let S=s+1;S<A.length;S+=1){const x=A[S],R=z.get(x),g=oe(x),k=Math.min(c.r,g.r)-Math.max(c.l,g.l),$=Math.min(c.b,g.b)-Math.max(c.t,g.t);if(!(k<=0||$<=0))if(k<$){const L=k/2+44,F=d.x<=R.x?1:-1;z.set(u,{x:d.x-L*F,y:d.y}),z.set(x,{x:R.x+L*F,y:R.y})}else{const L=$/2+34,F=d.y<=R.y?1:-1;z.set(u,{x:d.x,y:d.y-L*F}),z.set(x,{x:R.x,y:R.y+L*F})}}}const Me=Array.from(m).map((t,s)=>{const u=N.get(t)??{},d=u.className?K.get(u.className):void 0,c=u.style??{},S={bg:c.bg??d?.bg,border:c.border??d?.border,text:c.text??d?.text},x=u.className==="decision"?"diamond":u.className==="startEnd"?"pill":"rounded";return{id:t,type:"mindmap",position:z.get(t)??{x:s%5*280,y:Math.floor(s/5)*180},data:be({label:(u.label??t).replace(/<br\/>/g,`
`),bgColor:S.bg??"",borderColor:S.border??"",textColor:S.text??"",shape:x})}}),Ee=b.map((t,s)=>{const u=z.get(t.source)??{x:0,y:0},d=z.get(t.target)??{x:0,y:0},c=d.x-u.x,S=d.y-u.y;return{...Y.get(t.source)!==Y.get(t.target)?Math.abs(c)>=Math.abs(S)?c>=0?{sourceHandle:"right-source",targetHandle:"left-target"}:{sourceHandle:"left-source",targetHandle:"right-target"}:S>=0?{sourceHandle:"bottom-source",targetHandle:"top-target"}:{sourceHandle:"top-source",targetHandle:"bottom-target"}:S>=0?{sourceHandle:"bottom-source",targetHandle:"top-target"}:{sourceHandle:"top-source",targetHandle:"bottom-target"},id:`edge-import-${Date.now()}-${s}-${Math.random().toString(36).slice(2,6)}`,source:t.source,target:t.target,type:"default",label:t.label,animated:!0,className:de("solid",!0),style:{strokeWidth:xe,stroke:Z,strokeDasharray:ve("solid"),strokeLinecap:"butt"},data:{label:t.label,style:"bezier",pattern:"solid",color:Z,animated:!0,thickness:xe}}});return{nodes:Me,edges:Ee}}function vn(l,q){if(l.size!==q.size)return!1;for(const p of l)if(!q.has(p))return!1;return!0}function hn({workspaceId:l,runtime:q}){const[p,P]=o.useState([]),[y,C]=o.useState([]),[m,N]=o.useState(null),[K,b]=o.useState(null),[E,O]=o.useState(new Set),[D,j]=o.useState(new Set),[V,ne]=o.useState(!1),[W,H]=o.useState(null),[re,Q]=o.useState(""),[U,se]=o.useState(null),[ce,he]=o.useState(0),[ie,we]=o.useState(!1),Y=cn,J=o.useRef(!1),ge=o.useRef(""),z=o.useRef(null),M=mn(),pe=Ue(),ae=o.useCallback(async()=>{const n=await rn(q,l);he(n.length),se(e=>{if(e&&n.some(a=>a.id===e))return e;const r=$e(l);return r&&n.some(a=>a.id===r)?r:n[0]?.id??null})},[q,l]);o.useEffect(()=>{ae()},[ae]),o.useEffect(()=>{se($e(l))},[l]),o.useEffect(()=>{if(typeof window>"u")return;const n=e=>{const r=e.detail;se(r?.mindmapId??null),ae()};return window.addEventListener(Oe,n),()=>window.removeEventListener(Oe,n)},[ae]),o.useEffect(()=>{let n=!0;return(async()=>{if(!U){J.current=!0,P([]),C([]),N(null),b(null),O(new Set),j(new Set),H(null),ge.current="",J.current=!1,we(!1);return}we(!0),J.current=!0;try{const r=await sn(q,l,U);if(!n)return;const i=(Array.isArray(r?.nodes)?r.nodes:[]).map(f=>{const v=f.data??{},{category:G,type:fe,emoji:w,icon:_,...X}=v,je=un(_,w),De=Number(X.progress??0),ue=Number.isFinite(De)?Math.max(0,Math.min(100,De)):0,_e=typeof X.progressVisible=="boolean"?X.progressVisible:ue>0;return{...f,type:"mindmap",data:{...be(),...X,progress:ue,progressVisible:_e,icon:je,tags:Array.isArray(X.tags)?X.tags:[]}}}),I=(Array.isArray(r?.edges)?r.edges:[]).map(f=>{const v=me(f,Z);return{...f,type:We(v.style),label:v.label,animated:v.animated,className:de(v.pattern,v.animated),style:{...f.style??{},stroke:v.color,strokeWidth:v.thickness,strokeDasharray:ve(v.pattern),strokeLinecap:v.pattern==="dotted"?"round":"butt"},data:{...v,animated:v.animated}}});P(i),C(I),N(null),b(null),O(new Set),j(new Set),H(null),ge.current=JSON.stringify({nodes:i,edges:I}),M.clear()}catch(r){if(!n)return;console.error("Failed to load mindmap",r),P([]),C([]),N(null),b(null),H(null)}finally{if(!n)return;J.current=!1,we(!1)}})(),()=>{n=!1}},[q,l,U]),o.useEffect(()=>{if(typeof window>"u"||!U||J.current)return;const n=JSON.stringify({nodes:p,edges:y});if(n===ge.current)return;const e=window.setTimeout(()=>{an(q,l,U,{nodes:p,edges:y,updatedAt:new Date().toISOString()}).then(()=>{ge.current=n}).catch(r=>console.error("Failed to auto-save mindmap",r))},350);return()=>window.clearTimeout(e)},[q,l,U,p,y]);const Se=o.useCallback(n=>{P(e=>Je(n,e))},[]),He=o.useCallback(n=>{C(e=>Ge(n,e))},[]),te=o.useCallback((n,e,r,a)=>{const i={label:"",style:"bezier",pattern:"solid",color:Z,animated:!0,thickness:xe};return{id:`edge-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,source:n,target:e,sourceHandle:r??void 0,targetHandle:a??void 0,type:We(i.style),label:i.label,animated:i.animated,className:de(i.pattern,i.animated),style:{strokeWidth:i.thickness,stroke:i.color,strokeDasharray:ve(i.pattern),strokeLinecap:i.pattern==="dotted"?"round":"butt"},data:i}},[]),qe=o.useCallback(n=>{!n.source||!n.target||n.source===n.target||y.some(r=>r.source===n.source&&r.target===n.target&&(r.sourceHandle??null)===(n.sourceHandle??null)&&(r.targetHandle??null)===(n.targetHandle??null))||(M.pushSnapshot(p,y),C(r=>r.concat(te(n.source,n.target,n.sourceHandle,n.targetHandle))))},[te,p,y,M]),Re=o.useCallback((n,e)=>{const r=n.shiftKey||n.metaKey||n.ctrlKey,a=e.id;N(e),b(null),H(null),O(T=>{if(!r)return new Set([a]);const I=new Set(T);return I.has(a)?I.delete(a):I.add(a),I}),r||j(new Set);const i=on("mindmap");i.left||ln({feature:"mindmap",left:!0,right:i.right})},[]),Le=o.useCallback(()=>{N(null),b(null),O(new Set),j(new Set),H(null)},[]),Te=o.useCallback((n,e)=>{if(n.button!==0)return;if(n.preventDefault(),n.stopPropagation(),(n.metaKey||n.ctrlKey)&&!n.shiftKey){const T=typeof window>"u"?n.clientX:Math.max(12,window.innerWidth-220-12),I=typeof window>"u"?n.clientY:Math.max(12,window.innerHeight-180-12);N(null),b(e.id),O(new Set),j(new Set([e.id])),H({edgeId:e.id,panel:null,x:Math.max(12,Math.min(n.clientX+12,T)),y:Math.max(12,Math.min(n.clientY+12,I))});return}const r=n.shiftKey||n.metaKey||n.ctrlKey;if(!r){b(null),H(null);return}N(null),b(e.id),O(a=>r?a:new Set),j(a=>{if(!r)return new Set([e.id]);const i=new Set(a);return i.has(e.id)?i.delete(e.id):i.add(e.id),i}),H(null)},[]),ke=o.useCallback((n,e)=>{!e.source||!e.target||y.some(a=>a.id!==n.id&&a.source===e.source&&a.target===e.target&&(a.sourceHandle??null)===(e.sourceHandle??null)&&(a.targetHandle??null)===(e.targetHandle??null))||(M.pushSnapshot(p,y),C(a=>Xe(n,e,a)))},[y,M,p]),B=o.useCallback((n,e)=>{C(r=>r.map(a=>a.id===n?e(a):a))},[]),ye=o.useCallback((n,e)=>{B(n,r=>{const a=me(r,Z);return{...r,label:e,data:{...a,label:e}}})},[B]),Pe=o.useCallback((n,e,r=!0)=>{r&&M.pushSnapshot(p,y),B(n,a=>{const i=me(a,Z);return{...a,animated:i.animated,className:de(i.pattern,i.animated),style:{...a.style??{},stroke:e,strokeWidth:i.thickness,strokeDasharray:ve(i.pattern),strokeLinecap:i.pattern==="dotted"?"round":"butt"},data:{...i,color:e,animated:i.animated}}})},[M,p,y,B]),Ke=o.useCallback((n,e)=>{M.pushSnapshot(p,y),B(n,r=>{const a=me(r,Z);return{...r,type:We(e),animated:a.animated,className:de(a.pattern,a.animated),style:{...r.style??{},stroke:a.color,strokeWidth:a.thickness,strokeDasharray:ve(a.pattern),strokeLinecap:a.pattern==="dotted"?"round":"butt"},data:{...a,style:e,animated:a.animated}}})},[M,p,y,B]),Ne=o.useCallback((n,e)=>{M.pushSnapshot(p,y),B(n,r=>{const a=me(r,Z),i=a.animated;return{...r,animated:i,className:de(e,i),style:{...r.style??{},stroke:a.color,strokeWidth:a.thickness,strokeDasharray:ve(e),strokeLinecap:e==="dotted"?"round":"butt"},data:{...a,pattern:e,animated:i}}})},[M,p,y,B]),Ie=o.useCallback((n,e)=>{M.pushSnapshot(p,y),B(n,r=>{const a=me(r,Z);return{...r,animated:e,className:de(a.pattern,e),data:{...a,animated:e}}})},[M,p,y,B]),oe=o.useCallback(n=>{H(e=>e?{...e,panel:e.panel===n?null:n}:null)},[]);o.useEffect(()=>{W&&(y.some(n=>n.id===W.edgeId)||H(null))},[W,y]),o.useEffect(()=>{K&&(y.some(n=>n.id===K)||b(null))},[K,y]),o.useEffect(()=>{if(!W||typeof window>"u")return;const n=e=>{z.current&&!z.current.contains(e.target)&&H(null)};return window.addEventListener("mousedown",n),()=>window.removeEventListener("mousedown",n)},[W]);const A=o.useCallback(()=>{M.pushSnapshot(p,y)},[M,p,y]),Me=o.useCallback(()=>{A();const n=pe.getViewport(),e=(window.innerWidth/2-n.x)/n.zoom,r=(window.innerHeight/2-n.y)/n.zoom,a={id:`node-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,position:{x:e-120+Math.random()*40-20,y:r-40+Math.random()*40-20},type:"mindmap",data:be({label:"New Node",icon:"",borderColor:""})};if(m){const i=m.id,T=te(i,a.id);P(f=>f.concat(a)),C(f=>[...f,T]);const I=p.find(f=>f.id===i);I&&(a.position={x:I.position.x+300,y:I.position.y+Math.random()*100-50},a.data.depth=(I.data.depth||0)+1,P(f=>f.map(v=>v.id===a.id?{...v,position:a.position,data:a.data}:v)))}else P(i=>i.concat(a))},[A,pe,m,p,te]),Ee=o.useCallback(()=>{if(!m)return;A();const n=240,e=Array.from({length:16},(f,v)=>{if(v===0)return 0;const G=Math.ceil(v/2);return(v%2===1?1:-1)*G*n}),r=y.filter(f=>f.source===m.id).map(f=>p.find(v=>v.id===f.target)).filter(Boolean),a=r.map(f=>f.position.x-m.position.x),i=e.find(f=>a.every(v=>Math.abs(v-f)>n*.66))??(r.length+1)*n,T={id:`node-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,position:{x:m.position.x+i,y:m.position.y+190},type:"mindmap",data:be({label:"New Node",depth:(m.data.depth||0)+1,borderColor:""})},I=te(m.id,T.id,"bottom-source","top-target");P(f=>[...f,T]),C(f=>[...f,I]),N(T)},[m,A,te,y,p]),t=o.useCallback(()=>{if(!m)return;A();const n=y.find(T=>T.target===m.id),e=n?p.find(T=>T.id===n.source):null,r={id:`node-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,position:{x:m.position.x,y:m.position.y+120},type:"mindmap",data:be({label:"New Node",depth:m.data.depth,borderColor:""})},a=[...p,r],i=[...y];e&&i.push(te(e.id,r.id)),P(a),C(i),N(r)},[m,y,p,A,te]),s=o.useCallback(()=>{if(!m)return;A();const n=m.id;P(e=>e.filter(r=>r.id!==n)),C(e=>e.filter(r=>r.source!==n&&r.target!==n)),N(null),O(new Set)},[m,A]),u=o.useCallback(()=>{K&&(A(),C(n=>n.filter(e=>e.id!==K)),b(null),j(new Set),H(null))},[K,A]),d=o.useCallback(()=>{const n=E,e=D;n.size===0&&e.size===0||(A(),P(r=>r.filter(a=>!n.has(a.id))),C(r=>r.filter(a=>!e.has(a.id)&&!n.has(a.source)&&!n.has(a.target))),N(null),b(null),O(new Set),j(new Set),H(null))},[E,D,A]),c=o.useCallback(()=>{if(!m)return;A();const n={...m,id:`node-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,position:{x:m.position.x+44,y:m.position.y+44},selected:!1,dragging:!1,data:{...m.data,tags:Array.isArray(m.data.tags)?[...m.data.tags]:[],createdAt:new Date().toISOString()}};P(e=>[...e,n]),N(n),b(null),H(null)},[m,A]),S=o.useCallback(()=>{const n=E,e=D;if(n.size===0&&e.size===0){m&&c();return}A();const r=48,a=48,i=new Map,I=p.filter(w=>n.has(w.id)).map((w,_)=>{const X=`node-${Date.now()}-${_}-${Math.random().toString(36).slice(2,5)}`;return i.set(w.id,X),{...w,id:X,position:{x:w.position.x+r,y:w.position.y+a},selected:!1,dragging:!1,data:{...w.data,tags:Array.isArray(w.data.tags)?[...w.data.tags]:[],createdAt:new Date().toISOString()}}}),f=y.filter(w=>e.has(w.id)||n.has(w.source)&&n.has(w.target)),v=[];for(let w=0;w<f.length;w+=1){const _=f[w],X=i.get(_.source)??_.source,je=i.get(_.target)??_.target;y.some(ue=>ue.source===X&&ue.target===je&&(ue.sourceHandle??null)===(_.sourceHandle??null)&&(ue.targetHandle??null)===(_.targetHandle??null))||v.push({..._,id:`edge-${Date.now()}-${w}-${Math.random().toString(36).slice(2,5)}`,source:X,target:je})}if(I.length===0&&v.length===0)return;P(w=>[...w,...I]),C(w=>[...w,...v]);const G=new Set(I.map(w=>w.id)),fe=new Set(v.map(w=>w.id));O(G),j(fe),N(I[0]??null),b(v[0]?.id??null),H(null)},[E,D,m,c,A,p,y]),x=o.useCallback(n=>{A(),P(e=>e.filter(r=>r.id!==n)),C(e=>e.filter(r=>r.source!==n&&r.target!==n)),N(e=>e?.id===n?null:e)},[A]);o.useEffect(()=>{if(typeof window>"u")return;const n=r=>{const a=r.detail;a?.nodeId&&(P(i=>i.map(T=>T.id===a.nodeId?{...T,data:{...T.data,[a.key]:a.value}}:T)),N(i=>i?.id===a.nodeId?{...i,data:{...i.data,[a.key]:a.value}}:i))},e=r=>{const a=r.detail;a?.nodeId&&x(a.nodeId)};return window.addEventListener("moduo:mindmap:node-update",n),window.addEventListener("moduo:mindmap:node-delete",e),()=>{window.removeEventListener("moduo:mindmap:node-update",n),window.removeEventListener("moduo:mindmap:node-delete",e)}},[x]);const R=o.useCallback(()=>{const n=M.undo(p,y);n&&(J.current=!0,P(n.nodes),C(n.edges),N(null),b(null),H(null),requestAnimationFrame(()=>{J.current=!1}))},[M,p,y]),g=o.useCallback(()=>{const n=M.redo(p,y);n&&(J.current=!0,P(n.nodes),C(n.edges),N(null),b(null),H(null),requestAnimationFrame(()=>{J.current=!1}))},[M,p,y]);o.useEffect(()=>{if(typeof window>"u")return;const n=r=>{ne(r.metaKey||r.ctrlKey)},e=()=>ne(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",n),window.addEventListener("blur",e),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",n),window.removeEventListener("blur",e)}},[]),o.useEffect(()=>{if(typeof window>"u")return;const n=e=>{const r=e.metaKey||e.ctrlKey,a=e.target,i=a.tagName==="INPUT"||a.tagName==="TEXTAREA"||a.isContentEditable;if(r&&e.key==="z"&&!e.shiftKey){e.preventDefault(),R();return}if(r&&e.key==="z"&&e.shiftKey){e.preventDefault(),g();return}if(!i){if(!r&&(e.key==="n"||e.key==="N")){e.preventDefault(),Me();return}if(r&&(e.key==="d"||e.key==="D")){(m||E.size>0||D.size>0)&&(e.preventDefault(),S());return}if(e.key==="Tab"&&m){e.preventDefault(),Ee();return}if(e.key==="Enter"&&m){e.preventDefault(),t();return}if(e.key==="Delete"||e.key==="Backspace"){if(e.key==="Backspace"&&e.preventDefault(),E.size>0||D.size>0){e.preventDefault(),d();return}if(m){e.preventDefault(),s();return}if(K){e.preventDefault(),u();return}return}if(e.key==="Escape"){if(W){H(null);return}if(K){b(null);return}N(null);return}}};return window.addEventListener("keydown",n),()=>window.removeEventListener("keydown",n)},[R,g,Me,m,K,Ee,t,c,S,s,u,d,W,E,D]);const k=o.useCallback(n=>{const e=p.find(r=>r.id===n);e&&(N(e),b(null),H(null),pe.setCenter(e.position.x+120,e.position.y+40,{zoom:1.2,duration:400}))},[p,pe]),$=W?y.find(n=>n.id===W.edgeId)??null:null,L=$?me($,Z):null,F=p,ee=o.useMemo(()=>y.map(n=>{const e=D.has(n.id),r=n.className??"";return{...n,className:`${r}${e?" mindmap-edge-selected":""}`.trim()}}),[y,D]);o.useEffect(()=>{const n=new Set(p.filter(e=>e.selected).map(e=>e.id));O(e=>vn(e,n)?e:n)},[p]),o.useEffect(()=>{L&&Q(L.color)},[$?.id,L?.color]);const Ce=o.useCallback(n=>{try{const e=fn(n);return A(),P(e.nodes),C(e.edges),N(null),b(null),O(new Set),j(new Set),H(null),{ok:!0}}catch(e){return{ok:!1,error:e instanceof Error?e.message:"Failed to parse Mermaid notation."}}},[A]);let le=null;return ce===0?le=h.jsxs("div",{className:"grid h-full place-content-center gap-3 text-center",children:[h.jsx("div",{className:"text-[40px]","aria-hidden":"true",children:"🧠"}),h.jsx("h2",{className:"text-[16px] font-bold text-[#c0c5d4]",children:"No mindmaps yet"}),h.jsx("p",{className:"text-[12px] text-[#5a5f6e] max-w-[280px]",children:"Use the selector next to Mindmap in the top nav to create your first map."})]}):U?ie?le=h.jsx("div",{className:"grid h-full place-content-center text-center",children:h.jsxs("div",{className:"flex flex-col items-center gap-3",children:[h.jsx("div",{className:"h-6 w-6 animate-spin rounded-full border-2 border-[#303429] border-t-emerald-500"}),h.jsx("p",{className:"text-[12px] text-[#7a846a]",children:"Loading mindmap…"})]})}):le=h.jsxs("div",{className:"relative -m-4 h-[calc(100%+2rem)] min-h-0 w-[calc(100%+2rem)]",children:[h.jsx(Ye,{nodes:F,edges:ee,nodeTypes:dn,panOnDrag:V,selectionOnDrag:!0,nodesDraggable:!V,onNodesChange:Se,onEdgesChange:He,onConnect:qe,onReconnect:ke,edgesReconnectable:!0,onEdgeClick:Te,onNodeClick:Re,onPaneClick:Le,minZoom:.08,maxZoom:2,fitView:!0,colorMode:"dark",proOptions:{hideAttribution:!0},defaultEdgeOptions:{animated:!0,style:{strokeWidth:2,stroke:Z}},className:`h-full ${V?"cursor-grab active:cursor-grabbing":"cursor-default"}`,style:{background:"#111111"},deleteKeyCode:null,"aria-label":"Mindmap canvas",children:h.jsx(en,{theme:Y})}),$&&L&&W?h.jsxs("div",{ref:z,className:"fixed z-40 w-[min(220px,calc(100vw-24px))] rounded-xl border border-[#2a2a2a] bg-[#141414]/95 p-2 shadow-2xl backdrop-blur-xl",style:{left:W.x,top:W.y},role:"dialog","aria-label":"Connection style menu",children:[h.jsxs("div",{className:"flex items-center gap-1",children:[h.jsx("button",{onClick:()=>oe("text"),className:`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${W.panel==="text"?"bg-[#262626] text-[#f1f1f1]":"bg-[#1a1a1a] text-[#cfcfcf]"}`,"aria-label":"Edit connection text",children:"T"}),h.jsx("button",{onClick:()=>oe("color"),className:`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${W.panel==="color"?"bg-[#262626] text-[#f1f1f1]":"bg-[#1a1a1a] text-[#cfcfcf]"}`,"aria-label":"Edit connection color",children:"◉"}),h.jsx("button",{onClick:()=>oe("shape"),className:`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${W.panel==="shape"?"bg-[#262626] text-[#f1f1f1]":"bg-[#1a1a1a] text-[#cfcfcf]"}`,"aria-label":"Edit connection style",children:"∿"}),h.jsx("button",{onClick:()=>oe("line"),className:`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${W.panel==="line"?"bg-[#262626] text-[#f1f1f1]":"bg-[#1a1a1a] text-[#cfcfcf]"}`,"aria-label":"Edit connection line pattern",children:"╌"}),h.jsx("button",{onClick:()=>Ie($.id,!L.animated),className:`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${L.animated?"bg-[#262626] text-[#f1f1f1]":"bg-[#1a1a1a] text-[#cfcfcf]"}`,"aria-label":L.animated?"Disable connection animation":"Enable connection animation",children:"◍"})]}),h.jsxs("div",{className:`overflow-hidden transition-all duration-200 ease-out ${W.panel?"mt-2 max-h-20 opacity-100":"max-h-0 opacity-0"}`,children:[W.panel==="text"?h.jsx("input",{value:L.label,onChange:n=>ye($.id,n.target.value),className:"h-8 w-[204px] rounded-lg border border-[#2f2f2f] bg-[#1a1a1a] px-2 text-[12px] text-[#d7d7d7] outline-none focus:border-[#666]",placeholder:"Connection text..."}):null,W.panel==="color"?h.jsx("div",{className:"grid gap-1",children:h.jsx("input",{value:re,onChange:n=>{const e=n.target.value;Q(e);const r=Fe(e);r&&Pe($.id,r,!1)},onBlur:()=>{const n=Fe(re);if(n){Pe($.id,n,!0),Q(n);return}Q(L.color)},onKeyDown:n=>{n.key==="Enter"&&(n.preventDefault(),n.currentTarget.blur()),n.key==="Escape"&&(n.preventDefault(),Q(L.color),n.currentTarget.blur())},className:"h-8 w-full rounded-lg border border-[#2f2f2f] bg-[#1a1a1a] px-2 font-mono text-[12px] text-[#d7d7d7] outline-none focus:border-[#666]",placeholder:"#ffffff",maxLength:7,"aria-label":"Connection color hex"})}):null,W.panel==="shape"?h.jsx("div",{className:"grid grid-cols-4 gap-1",children:gn.map(n=>h.jsx("button",{className:`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all duration-200 hover:scale-[1.03] ${L.style===n.value?"bg-[#262626] text-[#f1f1f1]":"bg-[#1a1a1a] text-[#cfcfcf]"}`,onClick:()=>Ke($.id,n.value),"aria-label":`Set connection style ${n.label}`,children:h.jsx("span",{className:"animate-pulse text-[13px]",children:n.icon})},n.value))}):null,W.panel==="line"?h.jsx("div",{className:"grid grid-cols-3 gap-1",children:[{value:"solid",icon:"—",label:"Solid"},{value:"dashed",icon:"╌",label:"Dashed"},{value:"dotted",icon:"⋯",label:"Dotted"}].map(n=>h.jsx("button",{className:`flex items-center justify-center rounded-md px-2 py-1.5 text-[11px] font-medium transition-all duration-200 hover:scale-[1.03] ${L.pattern===n.value?"bg-[#262626] text-[#f1f1f1]":"bg-[#1a1a1a] text-[#cfcfcf]"}`,onClick:()=>Ne($.id,n.value),"aria-label":`Set connection line ${n.label}`,children:h.jsx("span",{className:"text-[14px]",children:n.icon})},n.value))}):null]})]}):null,h.jsx("div",{className:"transition-all duration-300 ease-out",children:h.jsx(nn,{})})]}):le=h.jsxs("div",{className:"grid h-full place-content-center gap-3 text-center",children:[h.jsx("div",{className:"text-[40px]","aria-hidden":"true",children:"🎯"}),h.jsx("h2",{className:"text-[16px] font-bold text-[#c0c5d4]",children:"Select a mindmap"}),h.jsx("p",{className:"text-[12px] text-[#5a5f6e]",children:"Choose a mindmap from the top nav dropdown."})]}),h.jsx(Ze,{feature:"mindmap",left:h.jsx(tn,{nodes:p,edges:y,selectedNodeId:m?.id??null,onSelectNode:k,onImportMermaid:Ce}),center:le})}function ze({workspaceId:l,runtime:q}){return h.jsx(Be,{children:h.jsx(hn,{workspaceId:l,runtime:q})})}ze.__docgenInfo={description:"",methods:[],displayName:"MindmapWorkspace",props:{workspaceId:{required:!0,tsType:{name:"string"},description:""},runtime:{required:!0,tsType:{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"listAccounts",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"connectAndSave",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"disconnect",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"listEnvelopes",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getMessageBody",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"prefetchBodies",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"syncNow",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"setActivityState",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"applyFlag",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getMailboxStatus",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"sendSaved",value:{name:"Promise",elements:[{name:"boolean"}],raw:"Promise<boolean>",required:!0}}]},required:!0}}]}},description:""}}};const Kn={title:"features/mindmap/ui/mindmap-workspace",component:ze,tags:["autodocs"]},Ae={args:{}};Ae.parameters={...Ae.parameters,docs:{...Ae.parameters?.docs,source:{originalSource:`{
  args: {}
}`,...Ae.parameters?.docs?.source}}};const On=["Primary"];export{Ae as Primary,On as __namedExportsOrder,Kn as default};
