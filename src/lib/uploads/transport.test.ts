import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

type TusOptions = Record<string, unknown> & {
  onBeforeRequest: (req: { setHeader: (k: string, v: string) => void }) => Promise<void>;
  onProgress: (loaded: number, total: number) => void;
  onSuccess: () => void;
  onError: (err: Error & { originalResponse?: unknown }) => void;
  fingerprint: () => Promise<string>;
};
const tus = { last: null as TusOptions | null, resumed: false, previous: [] as unknown[] };

rs.mock("tus-js-client", () => ({
  Upload: class {
    constructor(_blob: Blob, opts: TusOptions) {
      tus.last = opts;
    }
    async findPreviousUploads() {
      return tus.previous;
    }
    resumeFromPreviousUpload() {
      tus.resumed = true;
    }
    start() {
      const o = tus.last as TusOptions;
      void o.onBeforeRequest({
        setHeader: (k, v) => ((o as Record<string, unknown>)[`sent:${k}`] = v),
      });
      o.onProgress(6, 9);
      o.onSuccess();
    }
    async abort() {}
  },
}));

import { AttachmentOpError } from "./errors";
import { TUS_THRESHOLD_BYTES, uploadObject } from "./transport";

/** A scripted XMLHttpRequest: records what was sent, answers with `status`. */
function installXhr(answer: { status?: number; body?: string; network?: boolean }) {
  const sent: { method?: string; url?: string; headers: Record<string, string>; body?: unknown } = {
    headers: {},
  };
  class FakeXhr {
    status = 0;
    responseText = "";
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open(method: string, url: string) {
      sent.method = method;
      sent.url = url;
    }
    setRequestHeader(k: string, v: string) {
      sent.headers[k] = v;
    }
    abort() {
      this.onabort?.();
    }
    send(body: unknown) {
      sent.body = body;
      queueMicrotask(() => {
        if (answer.network) {
          this.onerror?.();
          return;
        }
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 3 } as ProgressEvent);
        this.status = answer.status ?? 200;
        this.responseText = answer.body ?? "{}";
        this.onload?.();
      });
    }
  }
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  return sent;
}

const realXhr = globalThis.XMLHttpRequest;
beforeEach(() => {
  tus.last = null;
  tus.resumed = false;
  tus.previous = [];
});
afterEach(() => {
  globalThis.XMLHttpRequest = realXhr;
});

const base = {
  supabaseUrl: "https://x.supabase.co",
  apiKey: "pk",
  getToken: async () => "tok",
  bucket: "attachments",
  path: "ws/a1/original.png",
  contentType: "image/png",
};

describe("uploadObject — small files: one request with progress", () => {
  it("POSTs the bytes to the object path with the token, the key and upsert", async () => {
    const sent = installXhr({});
    const progress: number[] = [];
    const blob = new Blob([new Uint8Array(3)]);
    await uploadObject({ ...base, blob, onProgress: (l) => progress.push(l) });
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("https://x.supabase.co/storage/v1/object/attachments/ws/a1/original.png");
    expect(sent.headers).toMatchObject({
      authorization: "Bearer tok",
      apikey: "pk",
      "x-upsert": "true",
      "content-type": "image/png",
    });
    expect(sent.body).toBe(blob);
    expect(progress).toEqual([1, 3]);
  });

  it("names Storage's refusals: 413 too large, an RLS 403 refused, 5xx a hiccup", async () => {
    const blob = new Blob([new Uint8Array(3)]);
    installXhr({ status: 413 });
    await expect(uploadObject({ ...base, blob })).rejects.toMatchObject({
      code: "upload_too_large",
      detail: { size_bytes: 3 },
    });
    installXhr({ status: 400, body: '{"message":"new row violates row-level security policy"}' });
    await expect(uploadObject({ ...base, blob })).rejects.toMatchObject({ code: "upload_refused" });
    installXhr({ status: 503 });
    await expect(uploadObject({ ...base, blob })).rejects.toBeInstanceOf(AttachmentOpError);
  });

  it("reports a dropped connection as a network error", async () => {
    installXhr({ network: true });
    await expect(uploadObject({ ...base, blob: new Blob([new Uint8Array(3)]) })).rejects.toThrow(
      /Network error/,
    );
  });

  it("refuses to send without a signed-in token", async () => {
    installXhr({});
    await expect(
      uploadObject({ ...base, getToken: async () => null, blob: new Blob(["x"]) }),
    ).rejects.toMatchObject({ code: "not_signed_in" });
  });
});

describe("uploadObject — big files: resumable (TUS)", () => {
  it("uses Supabase's resumable endpoint with 6 MB chunks, keyed by the object path", async () => {
    const blob = new Blob([new Uint8Array(TUS_THRESHOLD_BYTES + 1)]);
    const progress: number[] = [];
    await uploadObject({ ...base, blob, onProgress: (l) => progress.push(l) });
    const o = tus.last as TusOptions;
    expect(o.endpoint).toBe("https://x.supabase.co/storage/v1/upload/resumable");
    expect(o.chunkSize).toBe(6 * 1024 * 1024);
    expect(o.metadata).toMatchObject({
      bucketName: "attachments",
      objectName: "ws/a1/original.png",
      contentType: "image/png",
    });
    expect(await o.fingerprint()).toBe("moduo-attachment:attachments/ws/a1/original.png");
    expect(o["sent:authorization"]).toBe("Bearer tok");
    expect(progress).toEqual([6]);
  });

  it("picks up a half-sent upload from before a restart", async () => {
    tus.previous = [{ uploadUrl: "https://x/u/1" }];
    await uploadObject({ ...base, blob: new Blob([new Uint8Array(TUS_THRESHOLD_BYTES + 1)]) });
    expect(tus.resumed).toBe(true);
  });
});
