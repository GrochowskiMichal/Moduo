/**
 * A small in-memory IndexedDB for the Notes cache tests (jsdom has none).
 * It plays what `idb.ts` and `people.ts` use: databases with object stores
 * (in-line or auto-increment keys), `get`/`getAll`/`getAllKeys`/`put`/
 * `delete`/`clear`/`count`/`openCursor`, transactions that complete once the
 * microtask queue drains, `deleteDatabase` and (optionally) `databases()`.
 * Writes apply when called, so a test can read the stores back directly.
 */

type Store = {
  keyPath?: string;
  autoIncrement: boolean;
  next: number;
  rows: Map<IDBValidKey, unknown>;
};
type Db = { version: number; stores: Map<string, Store> };

type Request = {
  result?: unknown;
  error?: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
  onblocked?: () => void;
};

function settle<T>(value: T): IDBRequest<T> {
  const request: Request = {};
  queueMicrotask(() => {
    request.result = value;
    request.onsuccess?.();
  });
  return request as unknown as IDBRequest<T>;
}

function storeApi(store: Store) {
  const keyOf = (value: unknown, key?: IDBValidKey): IDBValidKey => {
    if (key !== undefined) return key;
    if (store.keyPath) return (value as Record<string, IDBValidKey>)[store.keyPath]!;
    return store.next++;
  };
  const sorted = () => [...store.rows.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    createIndex: () => undefined,
    get: (key: IDBValidKey) => settle(store.rows.get(key)),
    getAll: () => settle(sorted().map(([, v]) => v)),
    getAllKeys: () => settle(sorted().map(([k]) => k)),
    count: () => settle(store.rows.size),
    put: (value: unknown, key?: IDBValidKey) => {
      const k = keyOf(value, key);
      store.rows.set(k, value);
      return settle(k);
    },
    add: (value: unknown, key?: IDBValidKey) => {
      const k = keyOf(value, key);
      store.rows.set(k, value);
      return settle(k);
    },
    delete: (key: IDBValidKey) => {
      store.rows.delete(key);
      return settle(undefined);
    },
    clear: () => {
      store.rows.clear();
      return settle(undefined);
    },
    openCursor: () => {
      const entries = sorted();
      let at = 0;
      const request: Request = {};
      const step = () =>
        queueMicrotask(() => {
          const entry = entries[at++];
          request.result = entry
            ? {
                value: entry[1],
                primaryKey: entry[0],
                continue: step,
              }
            : null;
          request.onsuccess?.();
        });
      step();
      return request as unknown as IDBRequest;
    },
  };
}

export type FakeIdb = {
  factory: IDBFactory;
  /** Names of the databases that exist. */
  names(): string[];
  /** A database as a test may seed it (a y-indexeddb document database, say). */
  createDatabase(name: string): void;
  /** Rows of one store of one database, by key. */
  rows(db: string, store: string): Map<IDBValidKey, unknown>;
  /** Plays a browser with or without `indexedDB.databases()`. */
  listDatabases(on: boolean): void;
  /** Empty every store and drop every other database; open handles stay valid. */
  reset(): void;
};

export function fakeIdb(): FakeIdb {
  const dbs = new Map<string, Db>();

  const databaseApi = (db: Db) => ({
    version: db.version,
    objectStoreNames: { contains: (name: string) => db.stores.has(name) },
    createObjectStore: (name: string, o?: { keyPath?: string; autoIncrement?: boolean }) => {
      const store: Store = {
        keyPath: o?.keyPath,
        autoIncrement: !!o?.autoIncrement,
        next: 1,
        rows: new Map(),
      };
      db.stores.set(name, store);
      return storeApi(store);
    },
    transaction: (names: string | string[]) => {
      const list = Array.isArray(names) ? names : [names];
      const tx: {
        objectStore(name: string): unknown;
        oncomplete?: () => void;
        onabort?: () => void;
        onerror?: () => void;
      } = {
        objectStore: (name) => {
          const store = db.stores.get(name);
          if (!store || !list.includes(name)) throw new Error(`No store ${name}`);
          return storeApi(store);
        },
      };
      // Every request settles in a microtask; the transaction ends after them.
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
    close: () => undefined,
    onversionchange: null as unknown,
  });

  const factory = {
    open(name: string, version?: number) {
      const request: Request = {};
      queueMicrotask(() => {
        let db = dbs.get(name);
        const want = version ?? db?.version ?? 1;
        const upgrade = !db || want > db.version;
        if (!db) {
          db = { version: want, stores: new Map() };
          dbs.set(name, db);
        }
        db.version = want;
        request.result = databaseApi(db);
        if (upgrade) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
    deleteDatabase(name: string) {
      const request: Request = {};
      queueMicrotask(() => {
        dbs.delete(name);
        request.onsuccess?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as Record<string, unknown>;
  const listing = async () => [...dbs.keys()].map((name) => ({ name }));
  factory.databases = listing;

  return {
    factory: factory as unknown as IDBFactory,
    names: () => [...dbs.keys()],
    createDatabase(name) {
      dbs.set(name, { version: 1, stores: new Map() });
    },
    rows(db, store) {
      return dbs.get(db)?.stores.get(store)?.rows ?? new Map();
    },
    listDatabases(on) {
      if (on) factory.databases = listing;
      else delete factory.databases;
    },
    reset() {
      for (const [name, db] of dbs) {
        if (name === "moduo-notes-v2") {
          for (const store of db.stores.values()) store.rows.clear();
        } else dbs.delete(name);
      }
      factory.databases = listing;
    },
  };
}
