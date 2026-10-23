// CV-20 in the account export (#31; CV-22's `extraFiles` seam): the custom
// emoji you added to this workspace, as their images, `emoji/<name>.<ext>`
// (under the export's `chat/files/`). Only yours and only live ones: someone
// else's emoji aren't your data, and a removed one is no longer the
// workspace's. A file that can't be read is left out.

import { CUSTOM_EMOJI_EXT } from "@contracts/vocabularies";

import type { ChatExportFile } from "../export";
import { type CustomEmoji, liveEmoji } from "./model";

export type EmojiExportReads = {
  /** The workspace's live emoji (runtime.chat.customEmoji). */
  list: (workspaceId: string) => Promise<CustomEmoji[]>;
  /** The stored bytes of these object paths (signedFileBytes over emojiUrls). */
  bytes: (paths: string[]) => Promise<Map<string, Uint8Array>>;
};

export async function customEmojiExportFiles(
  reads: EmojiExportReads,
  workspaceId: string,
  selfId: string,
): Promise<ChatExportFile[]> {
  const mine = liveEmoji(await reads.list(workspaceId)).filter((e) => e.createdBy === selfId);
  if (mine.length === 0) return [];
  const got = await reads.bytes(mine.map((e) => e.storagePath));
  const files: ChatExportFile[] = [];
  for (const e of mine) {
    const bytes = got.get(e.storagePath);
    if (bytes) files.push({ path: `emoji/${e.name}.${CUSTOM_EMOJI_EXT[e.mime]}`, bytes });
  }
  return files;
}
