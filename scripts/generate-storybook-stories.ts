import { promises as fs } from "node:fs";
import path from "node:path";

type Options = {
  dryRun: boolean;
  force: boolean;
};

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = path.join(PROJECT_ROOT, "src");

function parseArgs(argv: string[]): Options {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  return { dryRun, force };
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(fullPath)));
      continue;
    }

    results.push(fullPath);
  }

  return results;
}

function isCandidateComponentFile(filePath: string) {
  if (!filePath.endsWith(".tsx")) return false;
  if (filePath.endsWith(".stories.tsx")) return false;
  if (filePath.endsWith(".test.tsx")) return false;
  if (filePath.endsWith(".spec.tsx")) return false;

  const rel = path.relative(SRC_ROOT, filePath).replaceAll(path.sep, "/");
  if (rel === "main.tsx") return false;
  if (rel === "router.tsx") return false;
  if (rel.startsWith("routes/")) return false;
  if (rel.startsWith("providers/")) return false;

  // Heuristic: focus on folders that usually contain UI components.
  return rel.includes("/components/") || rel.startsWith("components/") || rel.includes("/ui/");
}

function guessExportedComponentName(source: string): { kind: "named"; name: string } | { kind: "default" } | null {
  // Default export (common for leaf components)
  if (/\bexport\s+default\b/.test(source)) return { kind: "default" };

  // Named export function ComponentName() / export const ComponentName =
  const namedFunction = source.match(/\bexport\s+function\s+([A-Z][A-Za-z0-9_]*)\b/);
  if (namedFunction?.[1]) return { kind: "named", name: namedFunction[1] };

  const namedConst = source.match(/\bexport\s+const\s+([A-Z][A-Za-z0-9_]*)\b/);
  if (namedConst?.[1]) return { kind: "named", name: namedConst[1] };

  return null;
}

function storyTitleFromPath(componentFilePath: string) {
  const rel = path.relative(SRC_ROOT, componentFilePath).replaceAll(path.sep, "/");
  const noExt = rel.replace(/\.tsx$/, "");

  // Group top-level folders nicely in Storybook sidebar.
  if (noExt.startsWith("components/")) return `Components/${noExt.slice("components/".length)}`;
  return noExt;
}

function storyFilePathFor(componentFilePath: string) {
  return componentFilePath.replace(/\.tsx$/, ".stories.tsx");
}

function storySourceFor(
  componentFilePath: string,
  exportInfo: { kind: "named"; name: string } | { kind: "default" }
) {
  const importPath = "./" + path.basename(componentFilePath, ".tsx");
  const title = storyTitleFromPath(componentFilePath);

  if (exportInfo.kind === "default") {
    const componentName = path
      .basename(componentFilePath, ".tsx")
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join("");

    return `import type { Meta, StoryObj } from "@storybook/react";

import ${componentName} from "${importPath}";

const meta: Meta<typeof ${componentName}> = {
  title: "${title}",
  component: ${componentName},
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};
`;
  }

  return `import type { Meta, StoryObj } from "@storybook/react";

import { ${exportInfo.name} } from "${importPath}";

const meta: Meta<typeof ${exportInfo.name}> = {
  title: "${title}",
  component: ${exportInfo.name},
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const allFiles = await walk(SRC_ROOT);
  const candidates = allFiles.filter(isCandidateComponentFile);

  let created = 0;
  let skipped = 0;
  let overwritten = 0;

  for (const componentFilePath of candidates) {
    const source = await fs.readFile(componentFilePath, "utf8");
    const exportInfo = guessExportedComponentName(source);
    if (!exportInfo) {
      skipped++;
      continue;
    }

    const storyFilePath = storyFilePathFor(componentFilePath);
    const alreadyExists = await exists(storyFilePath);

    if (alreadyExists && !options.force) {
      skipped++;
      continue;
    }

    const storySource = storySourceFor(componentFilePath, exportInfo);

    if (!options.dryRun) {
      await fs.writeFile(storyFilePath, storySource, "utf8");
    }

    if (alreadyExists) overwritten++;
    else created++;
  }

  const mode = options.dryRun ? "DRY RUN" : "DONE";
  // eslint-disable-next-line no-console
  console.log(
    `[storybook:gen] ${mode} - created ${created}, overwritten ${overwritten}, skipped ${skipped} (use --force to overwrite, --dry-run to preview)`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[storybook:gen] FAILED", err);
  process.exitCode = 1;
});

