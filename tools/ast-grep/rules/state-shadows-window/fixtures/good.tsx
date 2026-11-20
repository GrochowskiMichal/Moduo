// Fixed: the global stays reachable. (A plain parameter called `window`, a time
// window in pure code, is left alone.)
export function useDays() {
  const [drawn, setDrawn] = useState(initialRange);
  window.localStorage.setItem("folds", JSON.stringify(drawn));
  return { drawn, setDrawn };
}

export function span(window: { from: number; to: number }) {
  return window.to - window.from;
}
