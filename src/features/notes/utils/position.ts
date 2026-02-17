const PAD = 16;
const STEP = 1024n;
const MIN = 0n;
const MAX = 9999999999999999n;

function parsePosition(value?: string | null): bigint | null {
  if (!value) return null;
  try {
    const parsed = BigInt(value);
    if (parsed < MIN || parsed > MAX) return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatPosition(value: bigint): string {
  return value.toString().padStart(PAD, "0");
}

export function initialPosition(): string {
  return formatPosition(5000000000000000n);
}

export function generatePosition(prev?: string | null, next?: string | null): string {
  const prevValue = parsePosition(prev);
  const nextValue = parsePosition(next);

  if (prevValue === null && nextValue === null) return initialPosition();

  if (prevValue !== null && nextValue !== null) {
    if (nextValue - prevValue > 1n) {
      return formatPosition((prevValue + nextValue) / 2n);
    }
    return formatPosition(prevValue + 1n);
  }

  if (prevValue !== null) {
    const candidate = prevValue + STEP;
    return formatPosition(candidate > MAX ? MAX : candidate);
  }

  if (nextValue !== null) {
    const candidate = nextValue - STEP;
    return formatPosition(candidate < MIN ? MIN : candidate);
  }

  return initialPosition();
}
