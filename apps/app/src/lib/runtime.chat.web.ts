/**
 * Chat runtime for web and desktop (specs/chat.md, specs/chat-v2.md): the
 * Supabase-backed implementation (`runtime.chat.supabase.ts`) on the app's
 * client (runtime.web.client.ts), read at call time.
 */

import type { ChatRuntime } from "../features/chat/model";
import { chatRuntimeOn } from "./runtime.chat.supabase";
import { supabaseClient } from "./runtime.web.client";

export const webChatRuntime: ChatRuntime = chatRuntimeOn(() => supabaseClient);
