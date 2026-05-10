import{j as r}from"./jsx-runtime-u17CrQMm.js";import{c as k}from"./core.esm-P1l0hGcK.js";import{W as P}from"./widget-container-aWgJwJ5K.js";import{C as w}from"./clock-widget-BUu6uHVi.js";import{C as q}from"./countdown-widget-jZI8tnFa.js";import{C as b}from"./crypto-widget-wVDrlZhj.js";import{H as I}from"./hydration-widget-DSRzKFqF.js";import{J as f}from"./job-tracker-widget-CiA0BWFx.js";import{N as h}from"./notes-widget-BZ46kEIj.js";import{P as j}from"./pomodoro-widget-Dxp32PD8.js";import{S as A}from"./stock-widget-D8pQ8-Bo.js";import{T as S}from"./tasks-widget-CiLD5y8Y.js";import{T}from"./todo-list-widget-C1JIwRPx.js";import{W as R}from"./weather-widget-BMleZ34H.js";function C({widgets:s,gridSize:i,isLocked:a,runtime:u,workspaceId:o,notes:l,tasks:m,projects:d,states:g,onResize:y,onRemove:p,onUpdateConfig:t}){const{isOver:v,setNodeRef:c}=k({id:"dashboard-grid",disabled:a});return r.jsxs("div",{ref:c,className:`relative h-full w-full transition-colors ${v&&!a?"bg-[#111111]/70":"bg-transparent"}`,style:{backgroundImage:a?"none":"radial-gradient(#2a2a2a 1px, transparent 1px)",backgroundSize:`${i}px ${i}px`},children:[s.map(e=>r.jsxs(P,{widget:e,gridSize:i,isLocked:a,onResize:y,onRemove:p,children:[e.type==="notes"?r.jsx(h,{notes:l,workspaceId:o,runtime:u,config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="tasks"?r.jsx(S,{tasks:m,projects:d,states:g,config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="clock"?r.jsx(w,{config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="weather"?r.jsx(R,{config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="stock"?r.jsx(A,{config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="crypto"?r.jsx(b,{config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="pomodoro"?r.jsx(j,{config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="hydration"?r.jsx(I,{config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="countdown"?r.jsx(q,{config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="todolist"?r.jsx(T,{config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null,e.type==="job-tracker"?r.jsx(f,{config:e.config,isLocked:a,onUpdateConfig:n=>t(e.id,n)}):null]},e.id)),s.length===0?r.jsx("div",{className:"pointer-events-none absolute inset-0 grid place-items-center",children:r.jsxs("div",{className:"text-center",children:[r.jsx("p",{className:"text-[26px] text-[#404040]",children:"+"}),r.jsx("p",{className:"text-[13px] text-[#8b8b8b]",children:"Board is empty"}),r.jsx("p",{className:"mt-1 text-[11px] text-[#676767]",children:a?"Unlock to add widgets.":"Drag widgets from the left panel."})]})}):null]})}C.__docgenInfo={description:"",methods:[],displayName:"DashboardGrid",props:{widgets:{required:!0,tsType:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig;
}`,signature:{properties:[{key:"id",value:{name:"string",required:!0}},{key:"type",value:{name:"union",raw:'"notes" | "tasks" | "clock" | "weather" | "stock" | "crypto" | "pomodoro" | "hydration" | "countdown" | "todolist" | "job-tracker"',elements:[{name:"literal",value:'"notes"'},{name:"literal",value:'"tasks"'},{name:"literal",value:'"clock"'},{name:"literal",value:'"weather"'},{name:"literal",value:'"stock"'},{name:"literal",value:'"crypto"'},{name:"literal",value:'"pomodoro"'},{name:"literal",value:'"hydration"'},{name:"literal",value:'"countdown"'},{name:"literal",value:'"todolist"'},{name:"literal",value:'"job-tracker"'}],required:!0}},{key:"x",value:{name:"number",required:!0}},{key:"y",value:{name:"number",required:!0}},{key:"w",value:{name:"number",required:!0}},{key:"h",value:{name:"number",required:!0}},{key:"config",value:{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]},required:!0}}]}}],raw:"WidgetInstance[]"},description:""},gridSize:{required:!0,tsType:{name:"number"},description:""},isLocked:{required:!0,tsType:{name:"boolean"},description:""},runtime:{required:!0,tsType:{name:"union",raw:"ModuoRuntime | null",elements:[{name:"signature",type:"object",raw:`{
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
| "custom"`,elements:[{name:"literal",value:'"backlog"'},{name:"literal",value:'"todo"'},{name:"literal",value:'"in_progress"'},{name:"literal",value:'"in_review"'},{name:"literal",value:'"done"'},{name:"literal",value:'"canceled"'},{name:"literal",value:'"custom"'}],required:!0}},{key:"icon",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"color",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}},{key:"position",value:{name:"string",required:!0}},{key:"createdAt",value:{name:"string",required:!0}},{key:"updatedAt",value:{name:"string",required:!0}},{key:"deletedAt",value:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}],required:!0}}]}}],raw:"TaskWorkflowState[]"},description:""},onResize:{required:!0,tsType:{name:"signature",type:"function",raw:"(id: string, w: number, h: number) => void",signature:{arguments:[{type:{name:"string"},name:"id"},{type:{name:"number"},name:"w"},{type:{name:"number"},name:"h"}],return:{name:"void"}}},description:""},onRemove:{required:!0,tsType:{name:"signature",type:"function",raw:"(id: string) => void",signature:{arguments:[{type:{name:"string"},name:"id"}],return:{name:"void"}}},description:""},onUpdateConfig:{required:!0,tsType:{name:"signature",type:"function",raw:"(id: string, patch: Partial<WidgetConfig>) => void",signature:{arguments:[{type:{name:"string"},name:"id"},{type:{name:"Partial",elements:[{name:"signature",type:"object",raw:`{
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
| "hired"`,elements:[{name:"literal",value:'"applied"'},{name:"literal",value:'"rejected"'},{name:"literal",value:'"replied"'},{name:"literal",value:'"preinterview"'},{name:"literal",value:'"interview"'},{name:"literal",value:'"technical"'},{name:"literal",value:'"behavioral"'},{name:"literal",value:'"staff"'},{name:"literal",value:'"decision"'},{name:"literal",value:'"hired"'}],required:!0}}]}}],raw:"JobApplicationEntry[]",required:!1}}]}}],raw:"Partial<WidgetConfig>"},name:"patch"}],return:{name:"void"}}},description:""}}};export{C as D};
