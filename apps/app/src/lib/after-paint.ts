// Run something once the browser has painted the current frame: a page's
// first rows paint, then the rest of it is built (TS-R1). The callback runs in
// a task after the next frame, so a React update it makes renders after that
// paint, at normal priority (a transition would restart on every store update
// that lands meanwhile). Returns a cancel for an effect's cleanup.

export function afterPaint(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(fn, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
  };
}
