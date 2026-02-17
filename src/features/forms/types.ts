export type FormFieldType = "short_text" | "long_text" | "email" | "number";

export type FormField = {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
};

export type FormSchema = {
  fields: FormField[];
};

export type FormStatus = "draft" | "published" | "archived";

export type Form = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description: string;
  schema: FormSchema;
  status: FormStatus;
  viewsCount: number;
  submissionsCount: number;
  lastSubmittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FormShareLink = {
  id: string;
  formId: string;
  workspaceId: string;
  slug: string;
  isActive: boolean;
  requireAccessCode: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FormSubmission = {
  id: string;
  formId: string;
  workspaceId: string;
  submittedAt: string;
  answers: Record<string, unknown> | unknown[];
  meta: Record<string, unknown>;
};
