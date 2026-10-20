/**
 * "Moving under a private note" (specs/notes-refresh.md NR-2): asked when a
 * shared note is moved under a private one. Esc or click-away keeps current
 * access; the move happens either way.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";

export function SharingQuestionDialog({
  open,
  onAnswer,
}: {
  open: boolean;
  /** `true` = "Match the new parent"; `false` = "Keep current access". */
  onAnswer: (match: boolean) => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && open) onAnswer(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Moving under a private note</AlertDialogTitle>
          <AlertDialogDescription>
            This note is shared, and its new parent is private. Who should be able to see it?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onAnswer(false)}>Keep current access</AlertDialogCancel>
          <AlertDialogAction onClick={() => onAnswer(true)}>Match the new parent</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
