import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LICENSE_PATH, lucideLicense } from "./export-icons";

it("ships lucide's licence next to its icons", () => {
  const committed = readFileSync(join(import.meta.dir, "../..", LICENSE_PATH), "utf8");
  expect(committed).toBe(lucideLicense());
  expect(committed).toContain("ISC");
});
