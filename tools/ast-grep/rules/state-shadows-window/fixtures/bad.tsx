// Pre-fix shape: state named after the global.
export function useDays() {
  // @flag
  const [window, setWindow] = useState(initialRange);
  return { window, setWindow };
}
