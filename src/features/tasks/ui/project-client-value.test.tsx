// A project's client is a person or a company (MOD-155): one search over
// both, grouped People and Companies; a pick saves only the key that changes.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = rs.hoisted(() => {
  const searchEntities = rs.fn();
  return { searchEntities, runtime: { spine: { searchEntities } } };
});

rs.mock("../../../lib/runtime", () => ({ getRuntime: () => mocks.runtime }));
rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { clientCopyClears, clientPatch, projectClient } from "../project-overview";
import { ProjectClientValue } from "./project-overview-parts";

const entity = (type: "contact" | "company", id: string, label: string) => ({
  workspaceId: "w",
  type,
  id,
  label,
  icon: null,
  deletedAt: null,
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  mocks.searchEntities.mockReset();
  mocks.searchEntities.mockImplementation(async ({ types }: { types: string[] }) =>
    types[0] === "company"
      ? [entity("company", "co1", "Acme Inc.")]
      : [entity("contact", "c1", "Anna Kowalski")],
  );
});
afterEach(cleanup);

function renderValue(props: Partial<Parameters<typeof ProjectClientValue>[0]> = {}) {
  const onChange = rs.fn();
  render(
    <TooltipProvider>
      <ProjectClientValue
        workspaceId="w"
        client={null}
        canEdit
        defaultOpen
        onChange={onChange}
        {...props}
      />
    </TooltipProvider>,
  );
  return onChange;
}

describe("the client picker (MOD-155)", () => {
  it("finds people and companies in one search, grouped", async () => {
    const onChange = renderValue();
    await screen.findByRole("option", { name: /Acme Inc\./ });
    expect(screen.getByText("People")).toBeTruthy();
    expect(screen.getByText("Companies")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Anna Kowalski/ })).toBeTruthy();
    expect(mocks.searchEntities.mock.calls.map((c) => c[0].types)).toEqual([
      ["contact"],
      ["company"],
    ]);
    fireEvent.click(screen.getByRole("option", { name: /Acme Inc\./ }));
    expect(onChange).toHaveBeenCalledWith({ type: "company", id: "co1" });
  });

  it("offers people only on a database from before company clients", async () => {
    renderValue({ companies: false });
    await screen.findByRole("option", { name: /Anna Kowalski/ });
    expect(screen.queryByText("Companies")).toBeNull();
    expect(mocks.searchEntities.mock.calls.map((c) => c[0].types)).toEqual([["contact"]]);
  });

  it("clears a company client with No client", async () => {
    const onChange = renderValue({ client: { type: "company", id: "co1" } });
    fireEvent.click(await screen.findByRole("option", { name: /No client/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("picking the client that's already set saves nothing", async () => {
    const onChange = renderValue({ client: { type: "company", id: "co1" } });
    fireEvent.click(await screen.findByRole("option", { name: /Acme Inc\./ }));
    await waitFor(() => expect(screen.queryByRole("option", { name: /Acme Inc\./ })).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("what a client edit saves (MOD-155)", () => {
  it("names the set client, company first", () => {
    expect(projectClient({ clientCompanyId: "co1", clientContactId: null })).toEqual({
      type: "company",
      id: "co1",
    });
    expect(projectClient({ clientContactId: "c1" })).toEqual({ type: "contact", id: "c1" });
    expect(projectClient({})).toBeNull();
  });

  it("sends only the key that changes; No client clears whichever is set", () => {
    const person = { clientContactId: "c1", clientCompanyId: null };
    expect(clientPatch(person, { type: "company", id: "co1" })).toEqual({ clientCompanyId: "co1" });
    expect(clientPatch(person, { type: "contact", id: "c2" })).toEqual({ clientContactId: "c2" });
    expect(clientPatch(person, null)).toEqual({ clientContactId: null });
    expect(clientPatch({ clientCompanyId: "co1" }, null)).toEqual({ clientCompanyId: null });
  });

  it("clears the other kind in the reader's copy, as the op does", () => {
    expect(
      clientCopyClears(
        { clientContactId: "c1", clientCompanyId: null },
        { clientCompanyId: "co1" },
      ),
    ).toEqual({ clientContactId: null });
    expect(clientCopyClears({ clientCompanyId: "co1" }, { clientContactId: "c1" })).toEqual({
      clientCompanyId: null,
    });
    // A row from before company clients keeps having no company field.
    expect(clientCopyClears({ clientContactId: "c1" }, { clientContactId: "c2" })).toEqual({});
    expect(clientCopyClears(undefined, { clientCompanyId: "co1" })).toEqual({});
  });
});
