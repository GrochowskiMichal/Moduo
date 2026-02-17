import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Form, FormField, FormSchema, FormShareLink, FormStatus, FormSubmission } from "../types";

type UseFormsParams = {
  userId: string | null;
  workspaceId: string | null;
  canEdit: boolean;
};

type ShareLinkRpcRow = {
  id: string;
  form_id: string;
  workspace_id: string;
  slug: string;
  is_active: boolean;
  require_access_code: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type FormRow = {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  description: string;
  schema: FormSchema | null;
  status: FormStatus;
  views_count: number;
  submissions_count: number;
  last_submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ShareLinkRow = {
  id: string;
  form_id: string;
  workspace_id: string;
  slug: string;
  is_active: boolean;
  require_access_code: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type SubmissionRow = {
  id: string;
  form_id: string;
  workspace_id: string;
  submitted_at: string;
  answers: Record<string, unknown> | unknown[];
  meta: Record<string, unknown>;
};

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mapForm(row: FormRow): Form {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    schema: row.schema && Array.isArray(row.schema.fields) ? row.schema : { fields: [] },
    status: row.status,
    viewsCount: Number(row.views_count ?? 0),
    submissionsCount: Number(row.submissions_count ?? 0),
    lastSubmittedAt: row.last_submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapShareLink(row: ShareLinkRow | ShareLinkRpcRow): FormShareLink {
  return {
    id: row.id,
    formId: row.form_id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    isActive: row.is_active,
    requireAccessCode: row.require_access_code,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeShareLinkRpc(data: unknown): ShareLinkRpcRow | null {
  if (!data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as ShareLinkRpcRow | undefined;
  if (!row?.id || !row?.form_id || !row?.slug) return null;
  return row;
}

function mapSubmission(row: SubmissionRow): FormSubmission {
  return {
    id: row.id,
    formId: row.form_id,
    workspaceId: row.workspace_id,
    submittedAt: row.submitted_at,
    answers: row.answers ?? {},
    meta: row.meta ?? {},
  };
}

function defaultSchema(): FormSchema {
  return {
    fields: [{ id: safeId(), label: "Question 1", type: "short_text", required: false }],
  };
}

export function useForms(supabase: SupabaseClient | null, params: UseFormsParams) {
  const { userId, workspaceId, canEdit } = params;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<FormShareLink | null>(null);
  const [recentSubmissions, setRecentSubmissions] = useState<FormSubmission[]>([]);
  const [expandedSubmissions, setExpandedSubmissions] = useState<Record<string, FormSubmission[]>>({});

  const selectedForm = useMemo(
    () => forms.find((form) => form.id === selectedFormId) ?? null,
    [forms, selectedFormId]
  );

  const loadForms = useCallback(async () => {
    if (!supabase || !workspaceId) {
      setForms([]);
      setSelectedFormId(null);
      setShareLink(null);
      setRecentSubmissions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("forms")
        .select("id,workspace_id,owner_id,name,description,schema,status,views_count,submissions_count,last_submitted_at,created_at,updated_at")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });

      if (error) throw error;

      const nextForms = ((data ?? []) as FormRow[]).map(mapForm);
      setForms(nextForms);
      setSelectedFormId((current) =>
        current && nextForms.some((form) => form.id === current) ? current : (nextForms[0]?.id ?? null)
      );
    } catch (nextError: any) {
      setError(nextError?.message ?? "Failed to load forms.");
    } finally {
      setLoading(false);
    }
  }, [supabase, workspaceId]);

  const loadFormDetail = useCallback(
    async (formId: string | null) => {
      if (!supabase || !formId) {
        setShareLink(null);
        setRecentSubmissions([]);
        return;
      }

      const [{ data: shareRows }, { data: submissionRows }] = await Promise.all([
        supabase
          .from("form_share_links")
          .select("id,form_id,workspace_id,slug,is_active,require_access_code,expires_at,created_at,updated_at")
          .eq("form_id", formId)
          .maybeSingle(),
        supabase
          .from("form_submissions")
          .select("id,form_id,workspace_id,submitted_at,answers,meta")
          .eq("form_id", formId)
          .order("submitted_at", { ascending: false })
          .limit(50),
      ]);

      setShareLink(shareRows ? mapShareLink(shareRows as ShareLinkRow) : null);
      setRecentSubmissions(((submissionRows ?? []) as SubmissionRow[]).map(mapSubmission));
    },
    [supabase]
  );

  const loadExpandedSubmissions = useCallback(
    async (formId: string) => {
      if (!supabase) return;
      const { data } = await supabase
        .from("form_submissions")
        .select("id,form_id,workspace_id,submitted_at,answers,meta")
        .eq("form_id", formId)
        .order("submitted_at", { ascending: false })
        .limit(6);
      setExpandedSubmissions((current) => ({
        ...current,
        [formId]: ((data ?? []) as SubmissionRow[]).map(mapSubmission),
      }));
    },
    [supabase]
  );

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  useEffect(() => {
    void loadFormDetail(selectedFormId);
  }, [loadFormDetail, selectedFormId]);

  const createForm = useCallback(async () => {
    if (!supabase || !workspaceId || !userId || !canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("forms")
        .insert({
          workspace_id: workspaceId,
          owner_id: userId,
          name: "Untitled form",
          description: "",
          schema: defaultSchema(),
          status: "draft",
        })
        .select("id,workspace_id,owner_id,name,description,schema,status,views_count,submissions_count,last_submitted_at,created_at,updated_at")
        .single();

      if (error) throw error;
      const created = mapForm(data as FormRow);
      setForms((current) => [created, ...current]);
      setSelectedFormId(created.id);
    } catch (nextError: any) {
      setError(nextError?.message ?? "Failed to create form.");
    } finally {
      setSaving(false);
    }
  }, [canEdit, supabase, userId, workspaceId]);

  const updateForm = useCallback(
    async (
      formId: string,
      patch: Partial<Pick<Form, "name" | "description" | "status" | "schema">>
    ) => {
      if (!supabase || !canEdit) return;
      setSaving(true);
      setError(null);
      try {
        const payload: Record<string, unknown> = {};
        if (patch.name !== undefined) payload.name = patch.name.trim() || "Untitled form";
        if (patch.description !== undefined) payload.description = patch.description;
        if (patch.status !== undefined) payload.status = patch.status;
        if (patch.schema !== undefined) payload.schema = patch.schema;

        if (Object.keys(payload).length === 0) return;

        const { data, error } = await supabase
          .from("forms")
          .update(payload)
          .eq("id", formId)
          .select("id,workspace_id,owner_id,name,description,schema,status,views_count,submissions_count,last_submitted_at,created_at,updated_at")
          .single();

        if (error) throw error;
        const next = mapForm(data as FormRow);
        setForms((current) =>
          current.map((form) => (form.id === formId ? next : form)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        );
      } catch (nextError: any) {
        setError(nextError?.message ?? "Failed to update form.");
      } finally {
        setSaving(false);
      }
    },
    [canEdit, supabase]
  );

  const archiveForm = useCallback(
    async (formId: string) => {
      if (!supabase || !canEdit) return;
      setSaving(true);
      setError(null);
      try {
        const { error } = await supabase.from("forms").update({ deleted_at: new Date().toISOString() }).eq("id", formId);
        if (error) throw error;
        setForms((current) => current.filter((form) => form.id !== formId));
        setSelectedFormId((current) => (current === formId ? null : current));
      } catch (nextError: any) {
        setError(nextError?.message ?? "Failed to archive form.");
      } finally {
        setSaving(false);
      }
    },
    [canEdit, supabase]
  );

  const setPublicLink = useCallback(
    async (args: {
      formId: string;
      requireAccessCode: boolean;
      accessCode?: string;
      regenerateSlug?: boolean;
      isActive?: boolean;
    }) => {
      if (!supabase || !canEdit) return null;
      setSaving(true);
      setError(null);
      try {
        const { data, error } = await supabase.rpc("forms_set_share_link", {
          p_form_id: args.formId,
          p_require_access_code: args.requireAccessCode,
          p_access_code: args.accessCode ?? null,
          p_regenerate_slug: args.regenerateSlug ?? false,
          p_is_active: args.isActive ?? true,
          p_expires_at: null,
        });
        if (error) throw error;
        const row = normalizeShareLinkRpc(data);
        if (!row) {
          throw new Error("Share link was not returned by RPC.");
        }
        const next = mapShareLink(row);
        setShareLink(next);
        return next;
      } catch (nextError: any) {
        setError(nextError?.message ?? "Failed to update share link.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [canEdit, supabase]
  );

  return {
    loading,
    saving,
    error,
    canEdit,
    forms,
    selectedForm,
    selectedFormId,
    shareLink,
    recentSubmissions,
    expandedSubmissions,
    setSelectedFormId,
    loadForms,
    loadExpandedSubmissions,
    createForm,
    updateForm,
    archiveForm,
    setPublicLink,
  };
}

export type UseFormsState = ReturnType<typeof useForms>;

export function createDraftField(index: number): FormField {
  return {
    id: safeId(),
    label: `Question ${index + 1}`,
    type: "short_text",
    required: false,
  };
}
