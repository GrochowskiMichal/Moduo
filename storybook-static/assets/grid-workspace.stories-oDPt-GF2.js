import{j as p}from"./jsx-runtime-u17CrQMm.js";import{f as B,h as U,D as G,k as O,P as $}from"./core.esm-P1l0hGcK.js";import{r as z}from"./index-BEwfMeI6.js";import{r as s}from"./index-B3d2A58Q.js";import{F as H}from"./feature-panels-shell-BdfMhs37.js";import{D as V}from"./dashboard-grid-CfsOpkur.js";import{r as N,G as C}from"./layout-events-BXnATdw6.js";import{W as Y}from"./widgets-panel-CquItB20.js";import"./index-AOmQ1fUN.js";import"./panel-events-BeJSmLTW.js";import"./widget-container-aWgJwJ5K.js";import"./widget-shell-D7048ePO.js";import"./createLucideIcon-CVEjH9DW.js";import"./x-mvR0woP4.js";import"./clock-widget-BUu6uHVi.js";import"./countdown-widget-jZI8tnFa.js";import"./crypto-widget-wVDrlZhj.js";import"./hydration-widget-DSRzKFqF.js";import"./job-tracker-widget-CiA0BWFx.js";import"./core-DhEqZVGG.js";import"./calendar-BmLrHsLg.js";import"./notes-widget-BZ46kEIj.js";import"./base64-8lUjvNYT.js";import"./pomodoro-widget-Dxp32PD8.js";import"./stock-widget-D8pQ8-Bo.js";import"./tasks-widget-CiLD5y8Y.js";import"./todo-list-widget-C1JIwRPx.js";import"./weather-widget-BMleZ34H.js";import"./lock-BWyN6z6d.js";const J=new Set(["notes","tasks","clock","weather","stock","crypto","pomodoro","hydration","countdown","todolist","job-tracker"]),M="dashboard-layout";function X(){return typeof crypto<"u"&&"randomUUID"in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`}function E(n,r){return`${n??"global"}:${r??"main"}`}function L(n,r){return`moduo:dashboard-layout:v1:${n??"global"}:${r??"main"}`}function D(n){if(!n)return null;try{const r=typeof n=="string"?JSON.parse(n):n;if(!Array.isArray(r.widgets))return null;const o=r.widgets.filter(e=>!!e&&typeof e.id=="string"&&typeof e.type=="string"&&J.has(e.type)).map(e=>({id:e.id,type:e.type,x:Math.max(0,Number(e.x??0)),y:Math.max(0,Number(e.y??0)),w:Math.max(2,Number(e.w??6)),h:Math.max(2,Number(e.h??4)),config:e.config??{}}));return{isLocked:r.isLocked??!1,widgets:o}}catch{return null}}function Z(n,r,o){const[e,m]=s.useState({isLocked:!1,widgets:[]}),[I,v]=s.useState(!0),y=s.useRef(!1);s.useEffect(()=>{if(!o||!n){m({isLocked:!1,widgets:[]}),y.current=!0,v(!1);return}y.current=!1,v(!0);const i=E(n,r);o.localStore.get(M,i).then(u=>{let t=D(u);if(!t&&typeof window<"u"){const a=window.localStorage.getItem(L(n,r));t=D(a),t&&(o.localStore.set(M,i,t).catch(console.error),window.localStorage.removeItem(L(n,r)))}m(t??{isLocked:!1,widgets:[]}),y.current=!0,v(!1)}).catch(()=>{m({isLocked:!1,widgets:[]}),y.current=!0,v(!1)})},[r,n,o]),s.useEffect(()=>{!o||!n||!y.current||o.localStore.set(M,E(n,r),e).catch(console.error)},[e,r,n,o]);const P=s.useCallback(()=>{m(i=>({...i,isLocked:!i.isLocked}))},[]),c=s.useCallback((i,u,t)=>{m(a=>({...a,widgets:[...a.widgets,{id:X(),type:i,x:Math.max(0,u),y:Math.max(0,t),w:6,h:5,config:{}}]}))},[]),R=s.useCallback((i,u,t)=>{m(a=>({...a,widgets:a.widgets.map(d=>d.id===i?{...d,x:Math.max(0,u),y:Math.max(0,t)}:d)}))},[]),f=s.useCallback((i,u,t)=>{m(a=>({...a,widgets:a.widgets.map(d=>d.id===i?{...d,w:Math.max(2,u),h:Math.max(2,t)}:d)}))},[]),h=s.useCallback(i=>{m(u=>({...u,widgets:u.widgets.filter(t=>t.id!==i)}))},[]),S=s.useCallback((i,u)=>{m(t=>({...t,widgets:t.widgets.map(a=>a.id===i?{...a,config:{...a.config,...u}}:a)}))},[]);return s.useMemo(()=>({layout:e,widgets:e.widgets,isLocked:e.isLocked,isLoading:I,toggleLock:P,addWidget:c,moveWidget:R,resizeWidget:f,removeWidget:h,updateWidgetConfig:S}),[c,I,e,R,h,f,P,S])}const b=40;function K({runtime:n,workspaceId:r,notes:o,tasks:e,projects:m,states:I}){const[v,y]=s.useState(()=>N(r)),{widgets:P,isLocked:c,isLoading:R,toggleLock:f,addWidget:h,moveWidget:S,resizeWidget:i,removeWidget:u,updateWidgetConfig:t}=Z(r,v,n),[a,d]=s.useState(null),T=s.useRef(null);s.useEffect(()=>{y(N(r))},[r]),s.useEffect(()=>{if(typeof window>"u")return;const l=k=>{const g=k.detail;g?.sceneId&&y(g.sceneId)};return window.addEventListener(C,l),()=>window.removeEventListener(C,l)},[]);const W=B(U($,{activationConstraint:{distance:8}})),F=l=>{c||d(l.active.data.current)},_=l=>{if(c)return;const k=l.active.data.current;if(d(null),!(!l.over||!k)){if(k.isSource){const g=k.type,w=l.active.rect.current.translated,q=T.current?.getBoundingClientRect();let A=0,x=0;w&&q&&(A=Math.round((w.left-q.left)/b),x=Math.round((w.top-q.top)/b)),h(g,A,x);return}if(k.isWidget){const g=P.find(A=>A.id===l.active.id);if(!g)return;const w=Math.max(0,g.x+Math.round(l.delta.x/b)),q=Math.max(0,g.y+Math.round(l.delta.y/b));S(g.id,w,q)}}};return p.jsxs(G,{sensors:W,onDragStart:F,onDragEnd:_,children:[p.jsx(H,{feature:"grid",left:p.jsx(Y,{isLocked:c,onToggleLock:f}),center:p.jsx("div",{ref:T,className:"h-full w-full",children:p.jsx(V,{widgets:P,gridSize:b,isLocked:c,runtime:n,workspaceId:r,notes:o,tasks:e,projects:m,states:I,onResize:i,onRemove:u,onUpdateConfig:t})})}),typeof document<"u"?z.createPortal(p.jsx(O,{dropAnimation:null,children:a?.isSource?p.jsx("div",{className:"rounded-xl border border-[#2a2a2a] bg-[#121212] px-3 py-2 text-[13px] text-[#e8e8e8]",children:a.label}):null}),document.body):null]})}K.__docgenInfo={description:"",methods:[],displayName:"GridWorkspace",props:{runtime:{required:!0,tsType:{name:"union",raw:"ModuoRuntime | null",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"listAccounts",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"connectAndSave",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"disconnect",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"listEnvelopes",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getMessageBody",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"prefetchBodies",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"syncNow",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"setActivityState",value:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>",required:!0}},{key:"applyFlag",value:{name:"Promise",elements:[{name:"any"}],raw:"Promise<any>",required:!0}},{key:"getMailboxStatus",value:{name:"Promise",elements:[{name:"Array",elements:[{name:"any"}],raw:"any[]"}],raw:"Promise<any[]>",required:!0}},{key:"sendSaved",value:{name:"Promise",elements:[{name:"boolean"}],raw:"Promise<boolean>",required:!0}}]},required:!0}}]}},{name:"null"}]},description:""},workspaceId:{required:!0,tsType:{name:"string"},description:""},notes:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
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
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"parentId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"title",value:{name:"string",required:!0}},{key:"icon",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"kind",value:{name:"union",raw:'"category" | "folder" | "note"',elements:[{name:"literal",value:'"category"'},{name:"literal",value:'"folder"'},{name:"literal",value:'"note"'}],required:!0}},{key:"tags",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!0}},{key:"isPinned",value:{name:"boolean",required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"isArchived",value:{name:"boolean",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"NoteMeta[]"},description:""},tasks:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  workspaceId: string;
  ownerId: string;
  projectId: string;
  taskCode: string | null;
  parentTaskId: string | null;
  childOfTaskId: string | null;
  blockedByTaskIds: string[];
  duplicateOfTaskId: string | null;
  stateId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  tags: string[];
  priority: TaskPriority;
  dueDate: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"projectId",value:{name:"string",required:!0}},{key:"taskCode",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"parentTaskId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"childOfTaskId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"blockedByTaskIds",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!0}},{key:"duplicateOfTaskId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"stateId",value:{name:"string",required:!0}},{key:"assigneeId",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"title",value:{name:"string",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"tags",value:{name:"Array",elements:[{name:"string"}],raw:"string[]",required:!0}},{key:"priority",value:{name:"union",raw:"0 | 1 | 2 | 3 | 4",elements:[{name:"literal",value:"0"},{name:"literal",value:"1"},{name:"literal",value:"2"},{name:"literal",value:"3"},{name:"literal",value:"4"}],required:!0}},{key:"dueDate",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"Task[]"},description:""},projects:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description: string;
  logoUrl: string | null;
  labels: ProjectLabel[];
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"description",value:{name:"string",required:!0}},{key:"logoUrl",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"labels",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  name: string;
  color: string;
}`,signature:{properties:[{key:"name",value:{name:"string",required:!0}},{key:"color",value:{name:"string",required:!0}}]}}],raw:"ProjectLabel[]",required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TaskProject[]"},description:""},states:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  workspaceId: string;
  ownerId: string;
  projectId: string;
  name: string;
  kind: TaskWorkflowKind;
  icon: string | null;
  color: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"workspaceId",value:{name:"string",required:!0}},{key:"ownerId",value:{name:"string",required:!0}},{key:"projectId",value:{name:"string",required:!0}},{key:"name",value:{name:"string",required:!0}},{key:"kind",value:{name:"union",raw:`| "backlog"
| "todo"
| "in_progress"
| "in_review"
| "done"
| "canceled"
| "custom"`,elements:[{name:"literal",value:'"backlog"'},{name:"literal",value:'"todo"'},{name:"literal",value:'"in_progress"'},{name:"literal",value:'"in_review"'},{name:"literal",value:'"done"'},{name:"literal",value:'"canceled"'},{name:"literal",value:'"custom"'}],required:!0}},{key:"icon",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"color",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TaskWorkflowState[]"},description:""}}};const Re={title:"features/dashboard/ui/grid-workspace",component:K,tags:["autodocs"]},j={args:{}};j.parameters={...j.parameters,docs:{...j.parameters?.docs,source:{originalSource:`{
  args: {}
}`,...j.parameters?.docs?.source}}};const Me=["Primary"];export{j as Primary,Me as __namedExportsOrder,Re as default};
