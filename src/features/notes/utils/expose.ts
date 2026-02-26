/**
 * Client-side utility for exposing/unexposing Moduo notes to the public
 * via the Moduo landing page Supabase project.
 *
 * Uses plain Supabase REST API (no SDK) — works in a Tauri/browser environment.
 */

import * as Y from "yjs";
import { decodeBase64ToUint8 } from "./base64";

const SUPABASE_URL = "https://ahhqsxjkwsqyszhxzjbc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_RfaTM1fcomIzU191dDS5kw_7TDtK_Kd";

type SupabaseResponse = { data?: unknown; error?: { message: string; code?: string } | null };

async function supabaseFetch(
    path: string,
    options: RequestInit = {}
): Promise<SupabaseResponse> {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const headers: Record<string, string> = {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers as Record<string, string>),
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const body = (await res.json()) as { message?: string };
            msg = body.message ?? msg;
        } catch {
            // ignore
        }
        return { error: { message: msg } };
    }
    let data: unknown = null;
    try {
        data = res.status === 204 ? null : await res.json();
    } catch {
        // no body
    }
    return { data };
}

export function buildSlug(title: string): string {
    const base = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "note";
    const suffix = Math.random().toString(36).slice(2, 7);
    return `${base}-${suffix}`;
}

// ─── Yjs text extraction ─────────────────────────────────────────────────────

function extractXmlText(node: Y.XmlElement, depth = 0): string {
    const parts: string[] = [];
    const nodeName = node.nodeName;

    for (const child of node.toArray()) {
        if (child instanceof Y.XmlElement) {
            const childName = child.nodeName;
            let childText = extractXmlText(child, depth + 1);

            // Emit markdown-style prefix based on Lexical node name
            if (childName === "heading") {
                const tag = child.getAttribute("tag") as string | undefined;
                const prefix = tag === "h1" ? "# " : tag === "h2" ? "## " : "### ";
                parts.push(`${prefix}${childText.trim()}`);
            } else if (childName === "quote") {
                const lines = childText.trim().split("\n");
                parts.push(lines.map((l) => `> ${l}`).join("\n"));
            } else if (childName === "code") {
                parts.push("```");
                parts.push(childText.trim());
                parts.push("```");
            } else if (childName === "listitem") {
                const listType = (node.getAttribute("listType") as string | undefined) ?? "bullet";
                const value = child.getAttribute("value") as number | undefined;
                const checked = child.getAttribute("checked");
                if (checked !== undefined) {
                    parts.push(`[${checked ? "x" : " "}] ${childText.trim()}`);
                } else if (listType === "number") {
                    parts.push(`${value ?? 1}. ${childText.trim()}`);
                } else {
                    parts.push(`- ${childText.trim()}`);
                }
            } else if (childName === "horizontalrule") {
                parts.push("---");
            } else {
                if (childText) parts.push(childText);
            }

            // Add newline after block-level nodes
            if (
                childName === "paragraph" ||
                childName === "heading" ||
                childName === "quote" ||
                childName === "code" ||
                childName === "listitem" ||
                childName === "horizontalrule"
            ) {
                parts.push("\n");
            }
        } else if (child instanceof Y.XmlText) {
            const chunk = extractXmlTextDelta(child);
            if (chunk) parts.push(chunk);
        }
    }

    const joined = parts.join("").replace(/\n{3,}/g, "\n\n").trim();

    // For list nodes, keep the list items with surrounding newlines
    if (nodeName === "list") {
        return joined + "\n";
    }

    return joined;
}

function extractXmlTextDelta(node: Y.XmlText): string {
    const parts: string[] = [];
    for (const op of node.toDelta()) {
        const v = op.insert as unknown;
        if (typeof v === "string") parts.push(v);
        else if (v instanceof Y.XmlElement) parts.push(extractXmlText(v));
        else if (v instanceof Y.XmlText) parts.push(extractXmlTextDelta(v));
    }
    return parts.join("");
}

/**
 * Decode a Yjs base64 snapshot and return plain text, preserving paragraph breaks.
 */
export function extractPlainTextFromYjsB64(b64: string): string {
    if (!b64) return "";
    try {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, decodeBase64ToUint8(b64));

        // Use doc.getXmlElement() (public API) instead of doc.share.get()
        // to avoid instanceof failures from dual-module issues.

        const rootV2 = doc.getXmlElement("root-v2");
        if (rootV2.toArray().length > 0) {
            const text = extractXmlText(rootV2)
                .replace(/\uFFFC/g, "")
                .replace(/\r\n/g, "\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
            if (text) return text;
        }

        const rootV1 = doc.getXmlElement("root");
        if (rootV1.toArray().length > 0) {
            const text = extractXmlText(rootV1)
                .replace(/\uFFFC/g, "")
                .replace(/\r\n/g, "\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
            if (text) return text;
        }

        return "";
    } catch {
        return "";
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type ExposeResult =
    | { success: true; slug: string; url: string }
    | { success: false; error: string };

/**
 * Expose a note publicly. Extracts plain text from the Yjs snapshot and
 * stores it alongside the binary, so the landing page can render it cleanly.
 */
export async function exposeNote(payload: {
    noteId: string;
    workspaceId: string;
    title: string;
    contentB64: string;
    assignedSlug?: string;
}): Promise<ExposeResult> {
    try {
        // Extract plain text now, in the Moduo app (yjs is available here)
        const contentText = extractPlainTextFromYjsB64(payload.contentB64);

        // Check if already exposed
        const existingRes = await supabaseFetch(
            `exposed_notes?note_id=eq.${encodeURIComponent(payload.noteId)}&select=slug`,
            { method: "GET" }
        );

        let slug: string;

        if (
            !existingRes.error &&
            Array.isArray(existingRes.data) &&
            (existingRes.data as { slug: string }[])[0]?.slug
        ) {
            // Re-expose — keep slug, update content
            slug = (existingRes.data as { slug: string }[])[0]!.slug;
            const updateRes = await supabaseFetch(
                `exposed_notes?note_id=eq.${encodeURIComponent(payload.noteId)}`,
                {
                    method: "PATCH",
                    headers: { Prefer: "return=representation" },
                    body: JSON.stringify({
                        title: payload.title,
                        content_b64: payload.contentB64,
                        content_text: contentText,
                        workspace_id: payload.workspaceId,
                        updated_at: new Date().toISOString(),
                    }),
                }
            );
            if (updateRes.error) throw new Error(updateRes.error.message);
        } else {
            // New expose
            slug = payload.assignedSlug || buildSlug(payload.title);
            const insertRes = await supabaseFetch("exposed_notes", {
                method: "POST",
                body: JSON.stringify({
                    note_id: payload.noteId,
                    workspace_id: payload.workspaceId,
                    title: payload.title,
                    content_b64: payload.contentB64,
                    content_text: contentText,
                    slug,
                    exposed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }),
            });
            if (insertRes.error) throw new Error(insertRes.error.message);

            // Read back the actual slug after insert
            const readBackRes = await supabaseFetch(
                `exposed_notes?note_id=eq.${encodeURIComponent(payload.noteId)}&select=slug`,
                { method: "GET" }
            );
            if (!readBackRes.error && Array.isArray(readBackRes.data)) {
                slug = (readBackRes.data as { slug: string }[])[0]?.slug ?? slug;
            }
        }

        return {
            success: true,
            slug,
            url: `https://moduo.app/notes/${slug}`,
        };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : "Failed to expose note",
        };
    }
}

/**
 * Check whether a note is currently exposed. Returns the slug or null.
 */
export async function getExposedSlug(noteId: string): Promise<string | null> {
    try {
        const res = await supabaseFetch(
            `exposed_notes?note_id=eq.${encodeURIComponent(noteId)}&select=slug`,
            { method: "GET" }
        );
        if (res.error || !Array.isArray(res.data)) return null;
        return (res.data as { slug: string }[])[0]?.slug ?? null;
    } catch {
        return null;
    }
}

/**
 * Remove the public exposure for a note.
 */
export async function unexposeNote(noteId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const res = await supabaseFetch(
            `exposed_notes?note_id=eq.${encodeURIComponent(noteId)}`,
            { method: "DELETE" }
        );
        if (res.error) throw new Error(res.error.message);
        return { success: true };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : "Failed to unexpose note",
        };
    }
}
