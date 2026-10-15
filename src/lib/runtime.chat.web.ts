/**
 * Chat runtime for web and desktop (specs/chat.md, specs/chat-v2.md): the
 * Supabase-backed implementation (`runtime.chat.supabase.ts`) on the app's
 * client. The client is read at call time: this module and runtime.web.ts
 * import each other.
 */

import type { ChatRuntime } from "../features/chat/model";
import { chatRuntimeOn } from "./runtime.chat.supabase";
import { supabaseClient } from "./runtime.web";

export const webChatRuntime: ChatRuntime = chatRuntimeOn(() => supabaseClient);
