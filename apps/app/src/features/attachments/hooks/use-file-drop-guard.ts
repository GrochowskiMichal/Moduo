import { useEffect } from "react";
import { dragHasFiles } from "../files";

/**
 * A file dropped where nothing takes it must not open in the window: the
 * browser (and, with `dragDropEnabled: false`, the desktop webview) would
 * navigate away from the app to show it. Drop zones handle their own drops
 * first (React's listeners run before these window ones), so this only refuses
 * the rest, with a "no drop" cursor.
 */
export function useFileDropGuard(): void {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.defaultPrevented || !dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    const onDrop = (e: DragEvent) => {
      if (dragHasFiles(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}
