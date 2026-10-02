export type CatalogEnum = {
  name: string;
  labels: string[];
};

export type CatalogColumn = {
  table: string;
  column: string;
  dataType: string;
  udtName: string;
};

export type CatalogGrant = {
  grantee: string;
  functionName: string;
  identityArguments: string;
  canExecute: boolean;
};

export type CatalogSnapshot = {
  enums: CatalogEnum[];
  constraints: string[];
  columns: CatalogColumn[];
  distinctValues: Record<string, string[]>;
  rowCounts: Record<string, number>;
  grants: CatalogGrant[];
};

export type PreflightIssue = {
  code: string;
  message: string;
  remediation: string;
};

export type PreflightResult = {
  ok: boolean;
  canonicalPlanTier: "founder" | "founders" | null;
  issues: PreflightIssue[];
};

const PLAN_TIERS = ["free", "pro", "team", "founder"] as const;
const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
const MEMBER_PERMISSIONS = ["read", "write", "none"] as const;
const EMAIL_PROVIDERS = ["gmail", "outlook", "icloud", "custom", "imap"] as const;
const CALENDAR_PROVIDERS = ["google", "microsoft", "caldav", "ics", "moduo"] as const;

function hasAll(actual: string[], expected: readonly string[]): boolean {
  return expected.every((value) => actual.includes(value));
}

function issue(code: string, message: string, remediation: string): PreflightIssue {
  return { code, message, remediation };
}

function valuesFor(snapshot: CatalogSnapshot, key: string): string[] {
  return snapshot.distinctValues[key] ?? [];
}

export function validateCatalogSnapshot(snapshot: CatalogSnapshot): PreflightResult {
  const issues: PreflightIssue[] = [];
  const planTier = snapshot.enums.find((entry) => entry.name === "plan_tier");

  if (!planTier) {
    issues.push(
      issue(
        "missing_plan_tier_enum",
        "public.plan_tier was not found in pg_enum.",
        "Stop before migration work and verify the live Supabase project/catalog.",
      ),
    );
  } else if (!hasAll(planTier.labels, PLAN_TIERS)) {
    issues.push(
      issue(
        "unexpected_plan_tier_labels",
        `public.plan_tier labels are [${planTier.labels.join(", ")}], expected at least [${PLAN_TIERS.join(", ")}].`,
        "Add an explicit compatibility mapping or update the approved migration plan; never assume generated types are live truth.",
      ),
    );
  }

  const canonicalPlanTier = planTier?.labels.includes("founder")
    ? "founder"
    : planTier?.labels.includes("founders")
      ? "founders"
      : null;

  const requiredColumns: CatalogColumn[] = [
    { table: "profiles", column: "plan_tier", dataType: "USER-DEFINED", udtName: "plan_tier" },
    { table: "workspace_members", column: "role", dataType: "text", udtName: "text" },
    { table: "workspace_members", column: "permissions_notes", dataType: "text", udtName: "text" },
    { table: "workspace_members", column: "permissions_tasks", dataType: "text", udtName: "text" },
    { table: "email_accounts", column: "provider", dataType: "text", udtName: "text" },
    { table: "calendar_accounts", column: "provider", dataType: "text", udtName: "text" },
  ];
  for (const expected of requiredColumns) {
    const actual = snapshot.columns.find(
      (column) => column.table === expected.table && column.column === expected.column,
    );
    if (!actual) {
      issues.push(
        issue(
          "missing_required_column",
          `${expected.table}.${expected.column} was not returned by information_schema.columns.`,
          "Stop before migration work and verify the live schema/table name.",
        ),
      );
    }
  }

  const roleValues = valuesFor(snapshot, "workspace_members.role");
  const unknownRoles = roleValues.filter(
    (value) => !MEMBER_ROLES.includes(value as (typeof MEMBER_ROLES)[number]),
  );
  if (unknownRoles.length > 0) {
    issues.push(
      issue(
        "unexpected_workspace_roles",
        `workspace_members.role contains unsupported values [${unknownRoles.join(", ")}].`,
        "Keep workspace-mappers.ts as the only member/editor bridge and inspect existing data before enforcement.",
      ),
    );
  }

  for (const key of [
    "workspace_members.permissions_notes",
    "workspace_members.permissions_tasks",
  ]) {
    const permissionValues = valuesFor(snapshot, key);
    if (
      permissionValues.some(
        (value) => !MEMBER_PERMISSIONS.includes(value as (typeof MEMBER_PERMISSIONS)[number]),
      )
    ) {
      issues.push(
        issue(
          "unexpected_workspace_permissions",
          `${key} contains unsupported values [${permissionValues.filter((value) => !MEMBER_PERMISSIONS.includes(value as (typeof MEMBER_PERMISSIONS)[number])).join(", ")}].`,
          "Normalize legacy permission spellings through workspace-mappers.ts before tightening constraints.",
        ),
      );
    }
  }

  const emailValues = valuesFor(snapshot, "email_accounts.provider");
  const unknownEmail = emailValues.filter(
    (value) => !EMAIL_PROVIDERS.includes(value as (typeof EMAIL_PROVIDERS)[number]),
  );
  if (unknownEmail.length > 0) {
    issues.push(
      issue(
        "unexpected_email_provider",
        `email_accounts.provider contains unsupported values [${unknownEmail.join(", ")}].`,
        "Normalize only the known imap→custom compatibility spelling; do not rigidly enum user/provider-owned values without evidence.",
      ),
    );
  }

  const calendarValues = valuesFor(snapshot, "calendar_accounts.provider");
  const unknownCalendar = calendarValues.filter(
    (value) => !CALENDAR_PROVIDERS.includes(value as (typeof CALENDAR_PROVIDERS)[number]),
  );
  if (unknownCalendar.length > 0) {
    issues.push(
      issue(
        "unexpected_calendar_provider",
        `calendar_accounts.provider contains unsupported values [${unknownCalendar.join(", ")}].`,
        "Preserve both stored moduo and current ics values; inspect unknown provider rows before migration.",
      ),
    );
  }

  const foundersRows = valuesFor(snapshot, "profiles.plan_tier").filter(
    (value) => value === "founders",
  );
  if (foundersRows.length > 0 && canonicalPlanTier === "founder") {
    issues.push(
      issue(
        "legacy_founders_rows",
        "profiles.plan_tier contains the non-canonical founders spelling while live enum canonical label is founder.",
        "Normalize founders→founder in a reviewed migration before any constraint/write-path enforcement.",
      ),
    );
  }

  const protectedGrant = (snapshot.grants ?? []).find(
    (grant) => grant.grantee === "anon" && grant.functionName.startsWith("workspace_op_"),
  );
  if (protectedGrant?.canExecute) {
    issues.push(
      issue(
        "anon_protected_rpc_execute",
        `${protectedGrant.functionName} is executable by anon.`,
        "Reassert REVOKE EXECUTE FROM anon in the approved migration and verify with has_function_privilege.",
      ),
    );
  }

  return { ok: issues.length === 0, canonicalPlanTier, issues };
}

export const PREFLIGHT_SQL = `
with
  enum_rows as (
    select jsonb_agg(jsonb_build_object(
      'name', t.typname,
      'labels', (
        select jsonb_agg(e.enumlabel order by e.enumsortorder)
        from pg_enum e where e.enumtypid = t.oid
      )
    ) order by t.typname) as rows
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  ),
  constraint_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'name', con.conname,
      'definition', pg_get_constraintdef(con.oid)
    ) order by c.relname, con.conname), '[]'::jsonb) as rows
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('profiles','workspace_members','tasks','module_activity','entity_links','contact_field_defs','email_accounts','calendar_accounts')
  ),
  column_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name,
      'column', column_name,
      'dataType', data_type,
      'udtName', udt_name
    ) order by table_name, ordinal_position), '[]'::jsonb) as rows
    from information_schema.columns
    where table_schema = 'public'
      and ((table_name, column_name) in (
        ('profiles','plan_tier'),
        ('workspace_members','role'),
        ('workspace_members','permissions_notes'),
        ('workspace_members','permissions_tasks'),
        ('email_accounts','provider'),
        ('calendar_accounts','provider')
      ))
  ),
  distinct_rows as (
    select jsonb_build_object(
      'profiles.plan_tier', (select coalesce(jsonb_agg(value order by value), '[]'::jsonb) from (select distinct plan_tier::text as value from public.profiles) q),
      'workspace_members.role', (select coalesce(jsonb_agg(value order by value), '[]'::jsonb) from (select distinct role::text as value from public.workspace_members) q),
      'workspace_members.permissions_notes', (select coalesce(jsonb_agg(value order by value), '[]'::jsonb) from (select distinct permissions_notes::text as value from public.workspace_members) q),
      'workspace_members.permissions_tasks', (select coalesce(jsonb_agg(value order by value), '[]'::jsonb) from (select distinct permissions_tasks::text as value from public.workspace_members) q),
      'email_accounts.provider', (select coalesce(jsonb_agg(value order by value), '[]'::jsonb) from (select distinct provider::text as value from public.email_accounts) q),
      'calendar_accounts.provider', (select coalesce(jsonb_agg(value order by value), '[]'::jsonb) from (select distinct provider::text as value from public.calendar_accounts) q)
    ) as rows
  ),
  count_rows as (
    select jsonb_build_object(
      'profiles', (select count(*) from public.profiles),
      'workspace_members', (select count(*) from public.workspace_members),
      'email_accounts', (select count(*) from public.email_accounts),
      'calendar_accounts', (select count(*) from public.calendar_accounts)
    ) as rows
  )
select jsonb_build_object(
  'enums', (select rows from enum_rows),
  'constraints', (select rows from constraint_rows),
  'columns', (select rows from column_rows),
  'distinctValues', (select rows from distinct_rows),
  'rowCounts', (select rows from count_rows)
) as preflight;`;
