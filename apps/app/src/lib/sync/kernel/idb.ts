// One way to open a sync database (sync kernel, Track C): Tasks' device copy
// (`moduo-sync`), Chat's (`moduo-chat`) and Notes' sync state
// (`moduo-notes-v2`) all open through `idbOpener`.
//
// An IndexedDB database can exist without one of its object stores (someone
// opened it without an upgrade handler, e.g. a test probe, or an older build
// made fewer stores), and `open(name, 1)` then fires no upgrade: every
// transaction on the missing store throws, so every write fails quietly for
// good (docs/gotchas/supabase.md, "An IndexedDB database can exist without
// its object store"). So the opener asks for no version, checks every store
// it needs, and reopens one version up to make what's missing.

/** The stores a database needs, each with what makes it (store, indexes). */
export type IdbSchema = {
  name: string;
  stores: Record<string, (db: IDBDatabase) => void>;
};

export type IdbOpener = {
  /** The open database with every store (opened once, reopened after another tab upgrades). */
  open(): Promise<IDBDatabase>;
  /** Close it (a delete of the database must not wait on this handle); the next `open` reopens. */
  close(): Promise<void>;
};

export function idbOpener(factory: IDBFactory, schema: IdbSchema): IdbOpener {
  let db: Promise<IDBDatabase> | null = null;
  const missing = (d: IDBDatabase) =>
    Object.keys(schema.stores).filter((name) => !d.objectStoreNames.contains(name));

  const openAt = (version?: number): Promise<IDBDatabase> =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request =
        version === undefined ? factory.open(schema.name) : factory.open(schema.name, version);
      request.onupgradeneeded = () => {
        for (const name of missing(request.result)) schema.stores[name]!(request.result);
      };
      request.onsuccess = () => {
        const opened = request.result;
        if (missing(opened).length === 0) {
          // Another tab upgrading must not wait on this one; the next call reopens.
          opened.onversionchange = () => {
            opened.close();
            db = null;
          };
          resolve(opened);
          return;
        }
        const next = opened.version + 1;
        opened.close();
        openAt(next).then(resolve, reject);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(`${schema.name} is blocked by another tab.`));
    });

  return {
    open() {
      db ??= openAt().catch((e) => {
        db = null;
        throw e;
      });
      return db;
    },
    async close() {
      const held = db;
      db = null;
      const opened = await held?.catch(() => null);
      opened?.close();
    },
  };
}

/** An IndexedDB request as a promise. */
export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves when the transaction commits; rejects (with an `Error` that names it) when it aborts. */
export function idbDone(tx: IDBTransaction, what = "The transaction"): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    // A DOMException reads as `null` in some reporters: wrap it.
    tx.onabort = () => reject(asError(tx.error, `${what} aborted.`));
    tx.onerror = () => reject(asError(tx.error, `${what} failed.`));
  });
}

function asError(e: DOMException | null, fallback: string): Error {
  if (!e) return new Error(fallback);
  const error = new Error(`${e.name}: ${e.message}`);
  error.name = e.name;
  return error;
}

/** The browser's IndexedDB, or null (tests, a locked-down browser). */
export function browserIdb(): IDBFactory | null {
  return typeof indexedDB === "undefined" ? null : indexedDB;
}
