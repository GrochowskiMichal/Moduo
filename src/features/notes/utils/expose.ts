/**
 * Client-side utility for exposing/unexposing Moduo notes to the public
 * via the Moduo landing page Supabase project.
 *
 * Uses plain Supabase REST API (no SDK) — works in a Tauri/browser environment.
 */

import * as Y from "yjs";
import { decodeBase64ToUint8 } from "./base64";

const SUPABASE_URL: string =
    (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
    "https://wtoonrvuqumihpkbvwvs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY: string =
    (import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined) ||
    "sb_publishable_NAVl-rzFzPOi5ZU84aC3pA_SOIR00so";

type SupabaseResponse = { data?: unknown; error?: { message: string; code?: string } | null };

type EmbedRef = {
    kind: "mindmap" | "task";
    itemId: string;
};

type ExposedEmbed =
    | {
        kind: "task";
        itemId: string;
        task: {
            title: string;
            description: string;
            priority: number;
            dueDate: string | null;
            tags: string[];
            updatedAt: string;
        };
    }
    | {
        kind: "mindmap";
        itemId: string;
        mindmap: {
            name: string;
            updatedAt: string;
            nodeCount: number;
            edgeCount: number;
            previewNodes: string[];
            nodes: Array<{
                id: string;
                type: string;
                position: { x: number; y: number };
                sourcePosition?: string;
                targetPosition?: string;
                data: Record<string, unknown>;
            }>;
            edges: Array<{
                id: string;
                source: string;
                target: string;
                type?: string;
                animated?: boolean;
                className?: string;
                style?: Record<string, unknown>;
                data?: Record<string, unknown>;
            }>;
        };
    };

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

export function extractEmbedsFromYjsB64(b64: string): EmbedRef[] {
    if (!b64) return [];
    try {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, decodeBase64ToUint8(b64));

        const out: EmbedRef[] = [];
        const seen = new Set<string>();

        const walk = (node: Y.XmlElement) => {
            if (node.nodeName === "embed") {
                const rawKind = node.getAttribute("kind") ?? node.getAttribute("__kind");
                const rawItemId = node.getAttribute("itemId") ?? node.getAttribute("__itemId");
                const kind = rawKind === "mindmap" || rawKind === "task" ? rawKind : null;
                const itemId = typeof rawItemId === "string" ? rawItemId.trim() : "";
                if (kind && itemId) {
                    const key = `${kind}:${itemId}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        out.push({ kind, itemId });
                    }
                }
            }

            for (const child of node.toArray()) {
                if (child instanceof Y.XmlElement) walk(child);
            }
        };

        const rootV2 = doc.getXmlElement("root-v2");
        if (rootV2.toArray().length > 0) {
            walk(rootV2);
            return out;
        }

        const rootV1 = doc.getXmlElement("root");
        if (rootV1.toArray().length > 0) {
            walk(rootV1);
        }

        return out;
    } catch {
        return [];
    }
}

async function buildEmbedsPayload(
    workspaceId: string,
    embedRefs: EmbedRef[]
): Promise<ExposedEmbed[]> {
    if (!embedRefs.length) return [];

    try {
        const { runtime } = await import("../../../lib/runtime");
        if (!runtime) return [];

        const payload: ExposedEmbed[] = [];

        // The legacy task embed was removed with the old tasks model; only
        // mindmap embeds are hydrated now. Any persisted task embed refs are
        // skipped.
        const mindmapRefs = embedRefs.filter((embed) => embed.kind === "mindmap");
        if (mindmapRefs.length) {
            try {
                const { listMindmaps, loadMindmapDocument } = await import("../../mindmap/ui/mindmap-storage");
                const maps = await listMindmaps(runtime, workspaceId);

                for (const ref of mindmapRefs) {
                    const mapMeta = maps.find((map: { id: string }) => map.id === ref.itemId);
                    if (!mapMeta) continue;
                    const doc = await loadMindmapDocument(runtime, workspaceId, ref.itemId);
                    if (!doc) continue;
                    const previewNodes = (Array.isArray(doc.nodes) ? doc.nodes : [])
                        .map((node: any) => String(node?.data?.label ?? node?.data?.title ?? "").trim())
                        .filter(Boolean)
                        .slice(0, 6);
                    const graphNodes = (Array.isArray(doc.nodes) ? doc.nodes : [])
                        .map((node: any, index: number) => {
                            const id = String(node?.id ?? `node-${index}`);
                            const x = Number(node?.position?.x ?? 0);
                            const y = Number(node?.position?.y ?? 0);
                            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                            return {
                                id,
                                type: String(node?.type ?? "mindmap"),
                                position: { x, y },
                                sourcePosition:
                                    typeof node?.sourcePosition === "string" ? node.sourcePosition : undefined,
                                targetPosition:
                                    typeof node?.targetPosition === "string" ? node.targetPosition : undefined,
                                data:
                                    node?.data && typeof node.data === "object"
                                        ? (node.data as Record<string, unknown>)
                                        : {},
                            };
                        })
                        .filter((node): node is NonNullable<typeof node> => !!node)
                        .slice(0, 120);
                    const nodeIdSet = new Set(graphNodes.map((node) => node.id));
                    const graphEdges = (Array.isArray(doc.edges) ? doc.edges : [])
                        .map((edge: any, index: number) => {
                            const source = String(edge?.source ?? "");
                            const target = String(edge?.target ?? "");
                            if (!source || !target) return null;
                            return {
                                id: String(edge?.id ?? `edge-${index}`),
                                source,
                                target,
                                type: typeof edge?.type === "string" ? edge.type : undefined,
                                animated: typeof edge?.animated === "boolean" ? edge.animated : undefined,
                                className: typeof edge?.className === "string" ? edge.className : undefined,
                                style:
                                    edge?.style && typeof edge.style === "object"
                                        ? (edge.style as Record<string, unknown>)
                                        : undefined,
                                data:
                                    edge?.data && typeof edge.data === "object"
                                        ? (edge.data as Record<string, unknown>)
                                        : undefined,
                            };
                        })
                        .filter((edge): edge is NonNullable<typeof edge> => !!edge)
                        .filter((edge) => edge.source && edge.target && nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
                        .slice(0, 220);

                    payload.push({
                        kind: "mindmap",
                        itemId: ref.itemId,
                        mindmap: {
                            name: mapMeta.name || "Untitled Mindmap",
                            updatedAt: mapMeta.updatedAt,
                            nodeCount: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
                            edgeCount: Array.isArray(doc.edges) ? doc.edges.length : 0,
                            previewNodes,
                            nodes: graphNodes,
                            edges: graphEdges,
                        },
                    });
                }
            } catch {
                // ignore embed hydration failures
            }
        }

        return payload;
    } catch {
        return [];
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
        const embeds = extractEmbedsFromYjsB64(payload.contentB64);
        const embedsPayload = await buildEmbedsPayload(payload.workspaceId, embeds);

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
                        embeds_json: embedsPayload,
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
                    embeds_json: embedsPayload,
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
