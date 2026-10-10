// Moves bytes to Supabase Storage (specs/attachments.md decision 3, AT2-1).
// Files over 6 MB use TUS resumable uploads (Supabase's documented path, 6 MB
// chunks), so a big file picks up where it stopped after a dropped connection
// or an app restart; smaller ones are one request, sent with XHR so the tile can
// show progress. Every write overwrites (`x-upsert`): a retry whose answer got
// lost lands on the same pending path, which AT-1's UPDATE policy allows.

import { AttachmentOpError } from "./errors";

export const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024;
/** Supabase's resumable endpoint takes 6 MB chunks exactly. */
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
/** Objects never change once ready (the guard trigger), so cache them long. */
const CACHE_SECONDS = "31536000";

export type UploadObjectInput = {
  supabaseUrl: string;
  apiKey: string;
  /** The signed-in person's access token, read fresh for every request. */
  getToken: () => Promise<string | null>;
  bucket: string;
  path: string;
  blob: Blob;
  contentType: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
};

/** A refused upload: what the queue should do about it. */
function refusal(status: number, message: string): AttachmentOpError {
  if (status === 413) return new AttachmentOpError("upload_too_large", null, status);
  if (status >= 500) return new AttachmentOpError("upload_server", null, status);
  // 400/403: the pending row moved on (finalized elsewhere, swept, older than
  // 24 h) or the guard refused the path. The queue starts the file over.
  return new AttachmentOpError(
    /row-level security|attachment_object_locked|unauthorized|403/i.test(message) || status === 403
      ? "upload_refused"
      : "upload_failed",
    null,
    status,
  );
}

function abortError(): Error {
  return new DOMException("The upload was cancelled.", "AbortError");
}

export function uploadObject(input: UploadObjectInput): Promise<void> {
  return input.blob.size > TUS_THRESHOLD_BYTES ? uploadResumable(input) : uploadStandard(input);
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function uploadStandard(input: UploadObjectInput): Promise<void> {
  const token = await input.getToken();
  if (!token) throw new AttachmentOpError("not_signed_in");
  if (input.signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${input.supabaseUrl}/storage/v1/object/${input.bucket}/${encodePath(input.path)}`,
    );
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", input.apiKey);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("content-type", input.contentType || "application/octet-stream");
    xhr.setRequestHeader("cache-control", `max-age=${CACHE_SECONDS}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) input.onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress?.(input.blob.size, input.blob.size);
        resolve();
        return;
      }
      reject(refusal(xhr.status, xhr.responseText ?? ""));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Network error: timed out"));
    xhr.onabort = () => reject(abortError());
    input.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(input.blob);
  });
}

async function uploadResumable(input: UploadObjectInput): Promise<void> {
  const { Upload } = await import("tus-js-client");
  if (input.signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(input.blob, {
      endpoint: `${input.supabaseUrl}/storage/v1/upload/resumable`,
      // The pending row's path is unique, so it is the resume key: a restart
      // finds the half-sent upload whatever the Blob's identity is now.
      fingerprint: async () => `moduo-attachment:${input.bucket}/${input.path}`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: TUS_CHUNK_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { apikey: input.apiKey, "x-upsert": "true" },
      metadata: {
        bucketName: input.bucket,
        objectName: input.path,
        contentType: input.contentType || "application/octet-stream",
        cacheControl: CACHE_SECONDS,
      },
      // Long uploads outlive an access token: read it per request.
      onBeforeRequest: async (req) => {
        const token = await input.getToken();
        if (token) req.setHeader("authorization", `Bearer ${token}`);
      },
      onProgress: (loaded, total) => input.onProgress?.(loaded, total),
      onError: (err) => {
        const status =
          "originalResponse" in err && err.originalResponse ? err.originalResponse.getStatus() : 0;
        if (!status) {
          reject(new Error(`Network error: ${err.message}`));
          return;
        }
        const body =
          "originalResponse" in err && err.originalResponse ? err.originalResponse.getBody() : "";
        reject(refusal(status, `${err.message} ${body ?? ""}`));
      },
      onSuccess: () => resolve(),
    });
    input.signal?.addEventListener(
      "abort",
      () => {
        void upload.abort();
        reject(abortError());
      },
      { once: true },
    );
    void upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}
