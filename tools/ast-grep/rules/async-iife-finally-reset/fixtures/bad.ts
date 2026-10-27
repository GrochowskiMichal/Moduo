// Pre-fix shapes: every `@flag` line must be reported.
class Store {
  private running: Promise<void> | null = null;

  run(): Promise<void> {
    if (this.running) return this.running;
    // @flag
    this.running = (async () => {
      try {
        if (this.done) return; // settles without awaiting: `finally` runs first
        await this.work();
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private done = false;
  private async work(): Promise<void> {}
}

const inflight = new Map<string, Promise<unknown>>();
export function cached(key: string, fetcher: () => Promise<unknown>) {
  // @flag
  const p = (async () => {
    try {
      return await fetcher();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

let reading: Promise<void> | null = null;
export function catchUp(read: () => Promise<void>) {
  // @flag
  reading ??= (async function () {
    try {
      await read();
    } finally {
      reading = null;
    }
  })();
  return reading;
}
