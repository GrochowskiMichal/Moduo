// Fixed shapes: nothing here may be reported.
export function DeleteButton({ onAsk }: { onAsk: () => void }) {
  return <button onClick={() => onAsk()} />;
}
