// Make a note follow its parent's sharing again (`share_op_follow_parent`):
// the "Match the new parent" answer when a shared note moves under a private
// one. Same transport as the rest of sharing (share-menu.tsx).

import { supabaseClient } from "../../lib/runtime.web";

export async function shareFollowParent(noteId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("share_op_follow_parent", { p_note_id: noteId });
  if (error) throw new Error(error.message);
}
