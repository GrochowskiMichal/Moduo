import{j as p}from"./jsx-runtime-u17CrQMm.js";import{r as _}from"./index-B3d2A58Q.js";import{D as ye,a as O,d as H,Y as K,b as B,e as Fe,c as We}from"./base64-8lUjvNYT.js";import{g as Le,i as ve}from"./position-CgOOMR7g.js";function W(){return typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}function ke(){return new Date().toISOString()}function te(i){const n=String(i??"").toLowerCase().trim().replace(/\s+/g,"_");return n==="todo"||n==="to_do"?"todo":n==="inprogress"||n==="in_progress"?"in_progress":n==="inreview"||n==="in_review"?"in_review":n==="done"?"done":n==="backlog"?"backlog":n==="canceled"||n==="cancelled"?"canceled":n||"todo"}function Ke(i){if(typeof i=="number"&&Number.isFinite(i))return Math.max(0,Math.min(4,Math.floor(i)));const n=String(i??"").toLowerCase().trim();if(!n)return 2;if(["critical","urgent","highest","p0","very_high"].includes(n))return 4;if(["high","p1"].includes(n))return 3;if(["medium","normal","p2"].includes(n))return 2;if(["low","p3"].includes(n))return 1;if(["lowest","trivial","p4"].includes(n))return 0;const s=Number(n);return Number.isFinite(s)?Math.max(0,Math.min(4,Math.floor(s))):2}function $(i){return i.toLowerCase().trim().replace(/\s+/g,"_").replace(/[^a-z0-9_\-.]/g,"")}function De(i){const n=i.trim();if(!n)return null;const s=S=>{try{return JSON.parse(S)}catch{return null}},r=s(n);if(r)return r;const I=n.match(/```json\s*([\s\S]*?)```/i)??n.match(/```\s*([\s\S]*?)```/i);if(I?.[1]){const S=s(I[1].trim());if(S)return S}const w=n.indexOf("{"),j=n.lastIndexOf("}");if(w>=0&&j>w){const S=s(n.slice(w,j+1));if(S)return S}return null}function we(i){const n=[];for(const s of i.toDelta()){const r=s.insert;if(typeof r=="string"){n.push(r);continue}if(r instanceof K){n.push(G(r));continue}if(r instanceof B){n.push(we(r));continue}}return n.join("")}function G(i){const n=[];for(const s of i.toArray()){if(s instanceof K){const r=G(s);r&&n.push(r),["paragraph","heading","quote","listitem","code"].includes(s.nodeName)&&n.push(`
`);continue}if(s instanceof B){const r=we(s);r&&n.push(r)}}return n.join("").replace(/\n{3,}/g,`

`).trim()}function Pe(i,n){const s=new K("paragraph"),r=new B;r.insert(0,n),s.insert(0,[r]),i.push([s])}function $e(i,n,s){const r=new K("heading");r.setAttribute("tag",n);const I=new B;I.insert(0,s),r.insert(0,[I]),i.push([r])}function Be(i,n){const s=new K("quote"),r=new B;r.insert(0,n),s.insert(0,[r]),i.push([s])}function Ue(i,n){const s=new K("code"),r=new B;r.insert(0,n),s.insert(0,[r]),i.push([s])}function fe(i,n,s){const r=new K("list");r.setAttribute("listType",n),s.forEach((I,w)=>{const j=new K("listitem");n==="number"&&j.setAttribute("value",String(w+1));const S=new K("paragraph"),P=new B;P.insert(0,I),S.insert(0,[P]),j.insert(0,[S]),r.push([j])}),i.push([r])}function Oe(i,n){const s=n.replace(/\r\n/g,`
`).split(`
`);let r=0;for(;r<s.length;){const w=(s[r]??"").trim();if(!w){r+=1;continue}if(w.startsWith("```")){const P=[];for(r+=1;r<s.length&&!(s[r]??"").trim().startsWith("```");)P.push(s[r]??""),r+=1;r<s.length&&(r+=1),Ue(i,P.join(`
`).trimEnd());continue}const j=w.match(/^(#{1,3})\s+(.*)$/);if(j){const P=j[1].length,x=j[2].trim();$e(i,P===1?"h1":P===2?"h2":"h3",x),r+=1;continue}if(w.startsWith(">")){const P=[];for(;r<s.length;){const x=(s[r]??"").trim();if(!x.startsWith(">"))break;P.push(x.replace(/^>\s?/,"")),r+=1}Be(i,P.join(`
`).trim());continue}if(/^[-*]\s+/.test(w)){const P=[];for(;r<s.length;){const F=(s[r]??"").trim().match(/^[-*]\s+(.*)$/);if(!F)break;P.push(F[1].trim()),r+=1}fe(i,"bullet",P);continue}if(/^\d+\.\s+/.test(w)){const P=[];for(;r<s.length;){const F=(s[r]??"").trim().match(/^\d+\.\s+(.*)$/);if(!F)break;P.push(F[1].trim()),r+=1}fe(i,"number",P);continue}const S=[w];for(r+=1;r<s.length;){const x=(s[r]??"").trim();if(!x||x.startsWith("```")||/^(#{1,3})\s+/.test(x)||x.startsWith(">")||/^[-*]\s+/.test(x)||/^\d+\.\s+/.test(x))break;S.push(x),r+=1}Pe(i,S.join(" ").trim())}}function ze(i,n,s){const r=i.getXmlElement("root-v2");if(s==="replace"){const w=r.toArray().length;w>0&&r.delete(0,w)}const I=n.replace(/\r\n/g,`
`).trim();if(!I){Pe(r,"");return}Oe(r,I)}async function Je(i,n,s,r){const I=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",signal:r,headers:{"Content-Type":"application/json",Authorization:`Bearer ${i}`,"HTTP-Referer":"https://moduo.app","X-Title":"Moduo"},body:JSON.stringify({model:n,messages:s,temperature:.2,max_tokens:4096})}),w=await I.json();if(!I.ok)throw new Error(w?.error?.message??w?.message??"OpenRouter request failed");const j=w?.choices?.[0]?.message?.content;return typeof j=="string"?j:Array.isArray(j)?j.map(S=>typeof S?.text=="string"?S.text:"").join(`
`).trim():""}function Xe({runtime:i,workspaceId:n,userId:s,notes:r,syncEngine:I,onCreateNote:w,onUpdateTitle:j}){const[S,P]=_.useState([]),[x,F]=_.useState(""),[D,re]=_.useState(!1),[he,ie]=_.useState(0),[se,ae]=_.useState(null),[z,oe]=_.useState(""),[be,qe]=_.useState([]),[Z,V]=_.useState([]),[Ie,ue]=_.useState(null),U=_.useMemo(()=>r.filter(t=>!t.deletedAt&&!t.isArchived),[r]),Se=_.useMemo(()=>{const t=new Map;for(const d of U){const u=$(d.title||"untitled");t.has(u)||t.set(u,d)}return t},[U]),J=_.useMemo(()=>{const t=x.match(/(?:^|\s)([@#])([a-zA-Z0-9_\-.]*)$/);if(!t)return null;const d=t[1],u=(t[2]??"").toLowerCase(),h=U.filter(l=>l.kind!=="category").filter(l=>!u||l.title.toLowerCase().includes(u)||$(l.title).includes(u)).slice(0,8);return{trigger:d,options:h}},[U,x]),Q=async()=>{if(!i)return;const t=await i.ai.listCredentials();qe(t),!z&&t[0]&&oe(t[0].id)};_.useEffect(()=>{Q()},[i]),_.useEffect(()=>{if(!D){ie(0);return}const t=setInterval(()=>{ie(d=>(d+1)%4)},380);return()=>clearInterval(t)},[D]);const X=async t=>{if(!i||!n)return"";try{if(I){const d=I.getOrCreateSession(t);await d.persistence.whenSynced;const u=G(d.doc.getXmlElement("root-v2"));if(u)return u}}catch{}try{const d=await i.notes.getDocState(n,t),u=new ye;d?.snapshotB64&&O(u,H(d.snapshotB64));for(const h of d?.updates??[])h?.updateB64&&O(u,H(h.updateB64));return G(u.getXmlElement("root-v2"))}catch{return""}},xe=t=>{const d=[...t.matchAll(/[@#]([a-zA-Z0-9_\-.]+)/g)].map(l=>l[1]),u=[],h=new Set;for(const l of d){const b=Se.get($(l));!b||h.has(b.id)||(h.add(b.id),u.push({id:b.id,title:b.title||"Untitled"}))}return u},Ae=async(t=420)=>Promise.all(U.slice(0,t).map(async d=>({id:d.id,title:d.title,alias:$(d.title||"untitled"),tags:d.tags,kind:d.kind,preview:(await X(d.id)).slice(0,8e3)}))),le=async(t,d,u)=>{if(!i||!n)return{ok:!1,reason:"Runtime unavailable"};const h=d.trim();if(!h)return{ok:!1,reason:"Empty content"};try{const l=await i.notes.getDocState(n,t),b=new ye;l?.snapshotB64&&O(b,H(l.snapshotB64));for(const C of l?.updates??[])C?.updateB64&&O(b,H(C.updateB64));b.transact(()=>{ze(b,h,u)},"ai-tool");const M=Fe(b);if(await i.notes.applyCrdtUpdates(n,t,`ai-tool:${W()}`,[{idempotencyKey:`ai-tool:${n}:${t}:${W()}`,clientSeq:1,updateB64:We(M)}]),I)try{const C=I.getOrCreateSession(t);O(C.doc,M,"remote")}catch{}const R=await X(t),y=h.slice(0,Math.min(80,h.length));return!R||!R.includes(y)?{ok:!1,reason:"Verification failed after note write"}:{ok:!0}}catch(l){return{ok:!1,reason:l instanceof Error?l.message:String(l)}}},je=async(t,d,u)=>{if(!i||!n||!s)return t.map(e=>({name:e.name,result:{error:"Runtime unavailable"}}));const h=e=>({id:String(e?.id??""),title:String(e?.title??"Untitled"),tags:Array.isArray(e?.tags)?e.tags.map(a=>String(a)):[],kind:String(e?.kind??"note"),deletedAt:e?.deletedAt??e?.deleted_at??null,isArchived:!!(e?.isArchived??e?.is_archived)});let l=(await i.notes.list(n)??[]).map(h);const b=(e,a)=>{if(e){const o=l.find(m=>m.id===e&&!m.deletedAt&&!m.isArchived);if(o)return o}if(a){const o=$(a),m=l.find(v=>!v.deletedAt&&!v.isArchived&&$(v.title)===o);if(m)return m}return u.lastCreatedNoteId?l.find(o=>o.id===u.lastCreatedNoteId&&!o.deletedAt&&!o.isArchived)??null:null};let M=await i.tasks.list(n),R=(M?.tasks??[]).filter(e=>!e?.deletedAt&&!e?.deleted_at),y=(M?.states??[]).filter(e=>!e?.deletedAt&&!e?.deleted_at),C=(M?.projects??[]).filter(e=>!e?.deletedAt&&!e?.deleted_at);const Y=async()=>{if(C.length>0&&y.length>0)return;const e=ke(),a=W();C.length===0&&await i.tasks.upsertProject({id:a,workspaceId:n,ownerId:s,name:"General",description:"",position:ve(),createdAt:e,updatedAt:e,deletedAt:null});const o=C[0]?.id??a;y.length===0&&await Promise.all([i.tasks.upsertState({id:W(),workspaceId:n,ownerId:s,projectId:o,name:"ToDo",kind:"todo",icon:"◯",color:"#C9CED6",position:"todo-01",createdAt:e,updatedAt:e,deletedAt:null}),i.tasks.upsertState({id:W(),workspaceId:n,ownerId:s,projectId:o,name:"In Progress",kind:"in_progress",icon:"◔",color:"#F5A524",position:"in_progress-02",createdAt:e,updatedAt:e,deletedAt:null}),i.tasks.upsertState({id:W(),workspaceId:n,ownerId:s,projectId:o,name:"Done",kind:"done",icon:"◉",color:"#2DD4BF",position:"done-03",createdAt:e,updatedAt:e,deletedAt:null})]),M=await i.tasks.list(n),R=(M?.tasks??[]).filter(m=>!m?.deletedAt&&!m?.deleted_at),y=(M?.states??[]).filter(m=>!m?.deletedAt&&!m?.deleted_at),C=(M?.projects??[]).filter(m=>!m?.deletedAt&&!m?.deleted_at)},g=[];for(const e of t){const a=e.arguments??{};try{if(e.name==="search_notes"){const o=String(a.query??"").toLowerCase().trim(),m=Math.max(1,Math.min(30,Number(a.limit??10))),v=l.filter(q=>q.kind!=="category"&&!q.deletedAt&&!q.isArchived).filter(q=>!o||q.title.toLowerCase().includes(o)||q.tags.some(L=>L.toLowerCase().includes(o))).slice(0,m).map(q=>({id:q.id,title:q.title,tags:q.tags,kind:q.kind}));g.push({name:e.name,result:v});continue}if(e.name==="read_note"){const o=b(typeof a.noteId=="string"?a.noteId:null,typeof a.noteTitle=="string"?a.noteTitle:null);if(!o){g.push({name:e.name,result:{error:"Note not found"}});continue}const m=await X(o.id);g.push({name:e.name,result:{id:o.id,title:o.title,tags:o.tags,content:m}});continue}if(e.name==="create_note"||e.name==="create_note_with_content"){const o=String(a.title??"").trim(),m=o.toLowerCase().trim(),v=/multiple notes|few notes|several notes|many notes|create \d+ notes/i.test(d);if(!m||m==="new note"||m.length<3){g.push({name:e.name,result:{error:"Rejected create_note due to empty/generic title"}});continue}const q=JSON.stringify({title:m,kind:a.kind??"note",parentId:a.parentId??null});if(u.createSignatures.has(q)){g.push({name:e.name,result:{error:"Rejected duplicate create_note in same run"}});continue}if(!v&&u.createdNotesInRun>=1){g.push({name:e.name,result:{error:"Rejected extra create_note; only one note allowed for this request"}});continue}const L=a.kind==="folder"||a.kind==="note"||a.kind==="category"?a.kind:"note",k=typeof a.parentId=="string"?a.parentId:null,c=await w(k,L);if(!c){g.push({name:e.name,result:{error:"Failed to create note"}});continue}u.createdNotesInRun+=1,u.createSignatures.add(q),u.lastCreatedNoteId=c,l=(await i.notes.list(n)??[]).map(h);let f=null;try{await j(c,o)}catch(A){f=A instanceof Error?A.message:String(A)}l=(await i.notes.list(n)??[]).map(h);const T=l.find(A=>A.id===c);if((!T||T.title!==o)&&(f=f??"Title update did not persist"),e.name==="create_note_with_content"){const A=String(a.content??"").trim();if(!A){g.push({name:e.name,result:{error:"create_note_with_content requires non-empty content",id:c}});continue}const E=await le(c,A,"replace");if(!E.ok){u.noteWriteFailures.push(`create_note_with_content(${c}): ${E.reason??"Failed to write note content"}`),g.push({name:e.name,result:{error:E.reason??"Failed to write note content",id:c}});continue}u.noteWritesInRun+=1,g.push({name:e.name,result:{id:c,title:o,kind:L,contentWritten:A.length,verified:!0,partialFailure:f?{renameWarning:f}:null}});continue}g.push({name:e.name,result:{id:c,title:o,kind:L,partialFailure:f?{renameWarning:f}:null}});continue}if(e.name==="update_note_content"||e.name==="append_note"){const o=b(typeof a.noteId=="string"?a.noteId:null,typeof a.noteTitle=="string"?a.noteTitle:null),m=String(a.content??"").trim();if(!o||!m){g.push({name:e.name,result:{error:"Missing note or content"}});continue}const v=e.name==="append_note"||a.mode==="append"?"append":"replace",q=await le(o.id,m,v);if(!q.ok){u.noteWriteFailures.push(`${e.name}(${o.id}): ${q.reason??"Failed to write note content"}`),g.push({name:e.name,result:{error:q.reason??"Failed to write note content",id:o.id}});continue}u.noteWritesInRun+=1,g.push({name:e.name,result:{id:o.id,mode:v,writtenChars:m.length,verified:!0}});continue}if(e.name==="list_tasks"){const o=String(a.query??"").toLowerCase().trim(),m=String(a.stateKind??"").toLowerCase().trim(),v=String(a.tag??"").toLowerCase().trim(),q=Math.max(1,Math.min(80,Number(a.limit??40))),L=R.filter(k=>{const c=String(k.title??"").toLowerCase(),f=String(k.description??"").toLowerCase(),T=Array.isArray(k.tags)?k.tags.map(E=>String(E).toLowerCase()):[],A=y.find(E=>E.id===(k.stateId??k.state_id));return!(o&&!c.includes(o)&&!f.includes(o)&&!T.some(E=>E.includes(o))||v&&!T.includes(v)||m&&String(A?.kind??"").toLowerCase()!==m)}).slice(0,q).map(k=>{const c=y.find(f=>f.id===(k.stateId??k.state_id));return{id:k.id,title:k.title,description:k.description,tags:k.tags??[],priority:k.priority,dueDate:k.dueDate??k.due_date??null,stateKind:c?.kind??null}});g.push({name:e.name,result:L});continue}if(e.name==="create_task"||e.name==="create_tasks"){await Y();const o=e.name==="create_tasks"?Array.isArray(a.tasks)?a.tasks:[]:[a];if(o.length===0){g.push({name:e.name,result:{error:"No tasks provided"}});continue}const m=[],v=[];for(let c=0;c<o.length;c+=1){const f=o[c]??{},T=String(f.title??"").trim();if(!T){v.push({index:c,reason:"Task title is required"});continue}const A=(typeof f.projectId=="string"&&C.some(N=>N.id===f.projectId)?f.projectId:C[0]?.id)??null;if(!A){v.push({index:c,reason:"No project available"});continue}const E=te(f.stateKind??"todo"),ee=y.find(N=>N.projectId===A&&te(N.kind)===E)?.id??y.find(N=>N.projectId===A&&te(N.kind)==="todo")?.id??y.find(N=>N.projectId===A)?.id;if(!ee){v.push({index:c,reason:"No workflow state available"});continue}const ne=R.filter(N=>(N.projectId??N.project_id)===A).sort((N,Ee)=>String(N.position??"").localeCompare(String(Ee.position??""))),Te=ne.length?Le(String(ne[ne.length-1]?.position??""),null):ve(),de=ke(),_e=Array.isArray(f.tags)?f.tags.map(N=>String(N).trim()).filter(Boolean):[],Me=f.dueDate?String(f.dueDate):null,ce=Ke(f.priority),ge=await i.tasks.upsertItem({id:W(),workspaceId:n,ownerId:s,projectId:A,parentTaskId:null,stateId:ee,assigneeId:null,title:T,description:String(f.description??""),tags:_e,priority:ce,dueDate:Me,position:Te,createdAt:de,updatedAt:de,deletedAt:null}),pe=String(ge?.id??"");if(!pe){v.push({index:c,reason:"Task write returned empty id"});continue}m.push({id:pe,title:T,projectId:A,stateId:ee,priority:ce}),R=[...R,ge]}const L=((await i.tasks.list(n))?.tasks??[]).filter(c=>!c?.deletedAt&&!c?.deleted_at),k=[];for(const c of m)if(L.some(T=>String(T?.id??"")===c.id))k.push(c),u.taskWritesInRun+=1;else{const T=`Task ${c.title} (${c.id}) missing after verification`;v.push({index:-1,reason:T}),u.taskWriteFailures.push(T)}if(e.name==="create_task")if(k[0])g.push({name:e.name,result:{...k[0],failures:v}});else{const c=v[0]?.reason??"Failed to create task";u.taskWriteFailures.push(c),g.push({name:e.name,result:{error:c}})}else k.length===0&&v.length>0&&u.taskWriteFailures.push(`create_tasks failed: ${v.map(c=>c.reason).join("; ")}`),g.push({name:e.name,result:{created:k,failures:v}});continue}g.push({name:e.name,result:{error:`Unknown tool: ${e.name}`}})}catch(o){g.push({name:e.name,result:{error:o instanceof Error?o.message:String(o)}})}}return g},Ne=async(t,d,u)=>{if(!i||!n||!s)throw new Error("Runtime unavailable");if(!z)throw new Error("No AI credential selected. Save one in Settings > AI first.");const h=await i.ai.getCredential(z),l=await Ae(420),b=await Promise.all(d.map(async g=>{const e=U.find(a=>a.id===g.id);return{id:g.id,title:g.title,tags:e?.tags??[],content:await X(g.id)}})),R=[{role:"system",content:`You are Moduo Agent. You can plan and execute work using tools.
Return strict JSON only.
Shape:
{ "type": "tool_calls", "tool_calls": [{ "name": string, "arguments": object }] }
or
{ "type": "final", "content": string }

Rules:
- Never create more than one note unless user explicitly asks for multiple.
- Never create a note with generic title like "New Note".
- If user asks to create a note and put content inside, call create_note_with_content in one step.
- If user asks to modify existing note content, call update_note_content.
- If user request implies writing note content, do not return final answer before successful write tool result.
- For note content tool args, use Markdown formatting (headings, lists, code blocks, quotes) when helpful.

Tools:
- search_notes({ query?: string, limit?: number })
- read_note({ noteId?: string, noteTitle?: string })
- create_note({ title: string, kind?: "note"|"folder"|"category", parentId?: string })
- create_note_with_content({ title: string, content: string, kind?: "note"|"folder"|"category", parentId?: string })
- update_note_content({ noteId?: string, noteTitle?: string, content: string, mode?: "replace"|"append" })
- append_note({ noteId?: string, noteTitle?: string, content: string })
- list_tasks({ query?: string, stateKind?: string, tag?: string, limit?: number })
- create_task({ title: string, description?: string, priority?: number, tags?: string[], stateKind?: string, projectId?: string, dueDate?: string })
- create_tasks({ tasks: Array<{ title: string, description?: string, priority?: number|string, tags?: string[], stateKind?: string, projectId?: string, dueDate?: string }> })

If user asks for Mermaid roadmap/graph, final content should be only a mermaid code block.`},{role:"user",content:JSON.stringify({userPrompt:t,attachedNotes:b,notesIndex:l},null,2)}],y={lastCreatedNoteId:null,createdNotesInRun:0,createSignatures:new Set,noteWritesInRun:0,noteWriteFailures:[],taskWritesInRun:0,taskWriteFailures:[]},C=/\bcreate\s+new\s+note\b|\bcreate\s+note\b|\binsert\b.*\bnote\b|\bput\b.*\bnote\b|\bupdate\b.*\bnote\b|\bappend\b.*\bnote\b/i.test(t),Y=/\bcreate\s+task\b|\bcreate\s+tasks\b|\badd\s+tasks?\b|\bgenerate\s+tasks?\b|\bassign\s+priorit/i.test(t);for(let g=0;g<8;g+=1){if(u.aborted)throw new Error("Cancelled");const e=await Je(h.apiKey,h.model,R,u),a=De(e);if(!a||typeof a!="object"||!a.type)return e;if(a.type==="final"&&typeof a.content=="string")return C&&(y.noteWriteFailures.length>0||y.noteWritesInRun===0)?`Failed to persist note content.

Details:
${y.noteWriteFailures.length?y.noteWriteFailures.map(m=>`- ${m}`).join(`
`):"- No successful note write was confirmed."}

Model summary (uncommitted):
${a.content}`:Y&&(y.taskWriteFailures.length>0||y.taskWritesInRun===0)?`Failed to persist task updates.

Details:
${y.taskWriteFailures.length?y.taskWriteFailures.map(m=>`- ${m}`).join(`
`):"- No successful task creation was confirmed."}

Model summary (uncommitted):
${a.content}`:a.content;if(a.type==="tool_calls"&&Array.isArray(a.tool_calls)){const o=await je(a.tool_calls,t,y),m=o.some(v=>v?.result?.error);R.push({role:"assistant",content:JSON.stringify(a)}),R.push({role:"user",content:JSON.stringify({toolResults:o})}),m&&R.push({role:"user",content:"Some tool calls failed. Produce final answer now and do not retry the same failing tool call repeatedly."});continue}return e}return C&&(y.noteWriteFailures.length>0||y.noteWritesInRun===0)?`Failed to persist note content before timeout.

Details:
${y.noteWriteFailures.length?y.noteWriteFailures.map(e=>`- ${e}`).join(`
`):"- No successful note write was confirmed."}`:Y&&(y.taskWriteFailures.length>0||y.taskWritesInRun===0)?`Failed to persist task updates before timeout.

Details:
${y.taskWriteFailures.length?y.taskWriteFailures.map(e=>`- ${e}`).join(`
`):"- No successful task creation was confirmed."}`:"I could not finish the tool run in time."},Re=t=>{V(d=>d.some(u=>u.id===t.id)?d:[...d,{id:t.id,title:t.title||"Untitled"}]),F(d=>d.replace(/(?:^|\s)[@#][a-zA-Z0-9_\-.]*$/," ").replace(/\s{2,}/g," "))},me=async()=>{const t=x.trim();if(!t||D)return;const d=xe(t),u=[...Z];for(const l of d)u.some(b=>b.id===l.id)||u.push(l);P(l=>[...l,{id:W(),role:"user",content:t}]),F(""),ae(null),re(!0);const h=new AbortController;ue(h);try{const l=await Ne(t,u,h.signal);P(b=>[...b,{id:W(),role:"assistant",content:l}]),V([]),window.dispatchEvent(new Event("moduo:data-refresh"))}catch(l){const b=l instanceof DOMException&&l.name==="AbortError"||l instanceof Error&&l.message==="Cancelled",M=l instanceof Error?l.message:String(l);b?P(R=>[...R,{id:W(),role:"assistant",content:"Stopped."}]):ae(M)}finally{re(!1),ue(null)}},Ce=()=>{Ie?.abort()};return p.jsxs("aside",{className:"grid min-h-0 grid-rows-[auto_1fr_auto] rounded-[14px] bg-[#111111] p-3",children:[p.jsxs("div",{className:"mb-2 grid gap-2",children:[p.jsxs("div",{className:"flex items-center justify-between",children:[p.jsx("div",{className:"text-[12px] uppercase tracking-[0.06em] text-[#8a8a8a]",children:"AI Chat"}),p.jsx("button",{type:"button",className:"rounded-md border border-[#2a2a2a] bg-[#171717] px-2 py-1 text-[11px] text-[#d2d2d2] hover:bg-[#1d1d1d]",onClick:()=>{Q()},children:"Refresh creds"})]}),p.jsxs("select",{value:z,onChange:t=>oe(t.target.value),onFocus:()=>{Q()},className:"h-9 rounded-lg border border-[#2b2b2b] bg-[#0f0f0f] px-2 text-[12px] text-[#e7e7e7] outline-none",children:[p.jsx("option",{value:"",children:"Select model credentials..."}),be.map(t=>p.jsxs("option",{value:t.id,children:[t.model," (",t.keyPreview,")"]},t.id))]})]}),p.jsxs("div",{className:"min-h-0 overflow-y-auto rounded-lg border border-[#1f1f1f] bg-[#0f0f0f] p-2",children:[S.length===0?p.jsx("div",{className:"text-[12px] text-[#7f7f7f]",children:"Use @ or # to attach notes. Example: based on @architecture_plan create a step-by-step note, then add tasks."}):p.jsx("div",{className:"grid gap-2",children:S.map(t=>p.jsxs("div",{className:`rounded-lg px-3 py-2 text-[12px] leading-relaxed ${t.role==="user"?"bg-[#1a1a1a] text-[#ebebeb]":"bg-[#141414] text-[#cbcbcb]"}`,children:[p.jsx("div",{className:"mb-1 text-[10px] uppercase tracking-[0.05em] text-[#7f7f7f]",children:t.role==="user"?"You":"Agent"}),p.jsx("div",{className:"whitespace-pre-wrap",children:t.content})]},t.id))}),D?p.jsxs("div",{className:"mt-2 rounded-lg bg-[#141414] px-3 py-2 text-[12px] text-[#bdbdbd]",children:[p.jsx("div",{className:"mb-1 text-[10px] uppercase tracking-[0.05em] text-[#7f7f7f]",children:"Agent"}),p.jsxs("div",{className:"whitespace-pre-wrap",children:["Thinking",".".repeat(he)]})]}):null]}),p.jsxs("div",{className:"mt-2 grid gap-2",children:[Z.length>0?p.jsx("div",{className:"flex flex-wrap gap-1",children:Z.map(t=>p.jsxs("button",{type:"button",className:"rounded-full border border-[#2a2a2a] bg-[#181818] px-2 py-0.5 text-[11px] text-[#b9b9b9]",onClick:()=>V(d=>d.filter(u=>u.id!==t.id)),children:["@",$(t.title)," ×"]},t.id))}):null,J&&J.options.length>0?p.jsx("div",{className:"max-h-28 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#121212] p-1",children:J.options.map(t=>p.jsxs("button",{type:"button",className:"flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] text-[#d6d6d6] hover:bg-[#1b1b1b]",onClick:()=>Re(t),children:[p.jsx("span",{className:"truncate",children:t.title||"Untitled"}),p.jsxs("span",{className:"text-[#7f7f7f]",children:[J.trigger,$(t.title||"untitled")]})]},t.id))}):null,p.jsx("textarea",{value:x,onChange:t=>F(t.target.value),onKeyDown:t=>{t.key==="Enter"&&!t.shiftKey&&(t.preventDefault(),me())},placeholder:"Ask OR Call anything..",className:"min-h-20 w-full resize-y rounded-lg border border-[#2b2b2b] bg-[#0f0f0f] px-3 py-2 text-[12px] text-[#ececec] outline-none"}),p.jsxs("div",{className:"flex items-center justify-between",children:[p.jsx("div",{className:"text-[11px] text-[#7f7f7f]",children:D?"Running - press Stop to cancel":"Enter to send"}),p.jsx("button",{type:"button",className:`rounded-md px-3 py-1.5 text-[12px] font-semibold ${D?"bg-[#8c2b2b] text-[#f7e8e8] hover:bg-[#a53131]":"bg-[#f0f0f0] text-[#111111] hover:bg-[#ffffff]"}`,onClick:()=>{if(D){Ce();return}me()},children:D?"Stop":"Send"})]}),se?p.jsx("div",{className:"text-[11px] text-[#ff9d9d]",children:se}):null]})]})}Xe.__docgenInfo={description:"",methods:[],displayName:"NotesAiChatPanel",props:{runtime:{required:!0,tsType:{name:"union",raw:"ModuoRuntime | null",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"listAccounts",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"connectAndSave",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"disconnect",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"listEnvelopes",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getMessageBody",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"prefetchBodies",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"syncNow",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"setActivityState",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"applyFlag",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getMailboxStatus",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"sendSaved",value:{name:"Promise",elements:[{name:"boolean"}],raw:"Promise<boolean>",required:!0}}]},required:!0}}]}},{name:"null"}]},description:""},workspaceId:{required:!0,tsType:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]},description:""},userId:{required:!0,tsType:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]},description:""},notes:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  workspaceId: string;
  ownerId: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  kind: NoteKind;
  tags: string[];
  isPinned: boolean;
  position: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"parentId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"title",value:{name:"string",required:!0}},{key:"icon",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"kind",value:{name:"union",raw:'"category" | "folder" | "note"',elements:[{name:"literal",value:'"category"'},{name:"literal",value:'"folder"'},{name:"literal",value:'"note"'}],required:!0}},{key:"tags",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!0}},{key:"isPinned",value:{name:"boolean",required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"isArchived",value:{name:"boolean",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"NoteMeta[]"},description:""},syncEngine:{required:!0,tsType:{name:"union",raw:"NotesSyncEngine | null",elements:[{name:"NotesSyncEngine"},{name:"null"}]},description:""},onCreateNote:{required:!0,tsType:{name:"signature",type:"function",raw:"(parentId?: string | null, kind?: NoteKind) => Promise<string | null>",signature:{arguments:[{type:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]},name:"parentId"},{type:{name:"union",raw:'"category" | "folder" | "note"',elements:[{name:"literal",value:'"category"'},{name:"literal",value:'"folder"'},{name:"literal",value:'"note"'}]},name:"kind"}],return:{name:"Promise",elements:[{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]}],raw:"Promise<string | null>"}}},description:""},onUpdateTitle:{required:!0,tsType:{name:"signature",type:"function",raw:"(noteId: string, title: string) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"noteId"},{type:{name:"string"},name:"title"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}}},description:""}}};export{Xe as N};
