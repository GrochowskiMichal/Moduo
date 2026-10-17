import { describe, expect, it } from "@rstest/core";

import { cn } from "./utils";

describe("cn", () => {
  it("lets an override replace a named @theme shadow (DS-2)", () => {
    // Without the extended scale, both survived and CSS order picked a winner.
    expect(cn("data-[state=active]:shadow-control-raised", "data-[state=active]:shadow-none")).toBe(
      "data-[state=active]:shadow-none",
    );
    expect(cn("shadow-overlay", "shadow-sm")).toBe("shadow-sm");
  });

  it("still merges state-layer fills and keeps unrelated text utilities", () => {
    expect(cn("bg-state-active hover:bg-state-active-hover", "bg-state-hover")).toBe(
      "hover:bg-state-active-hover bg-state-hover",
    );
    expect(cn("text-2xs text-muted-foreground", "text-foreground")).toBe(
      "text-2xs text-foreground",
    );
  });
});
