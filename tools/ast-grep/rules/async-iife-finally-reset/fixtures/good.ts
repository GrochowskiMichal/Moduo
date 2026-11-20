// Fixed shapes: nothing here may be reported.
class Store {
  private running: Promise<void> | null = null;

  run(): Promise<void> {
    if (this.running) return this.running;
    // `.finally` runs after the assignment, even when the work settles at once.
    this.running = this.work().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async work(): Promise<void> {}
}

// An async IIFE without a `finally`, or one that is only awaited, is fine.
export async function once(load: () => Promise<number>) {
  const value = (async () => (await load()) + 1)();
  await (async () => {
    try {
      await load();
    } finally {
      console.log("done");
    }
  })();
  return value;
}
