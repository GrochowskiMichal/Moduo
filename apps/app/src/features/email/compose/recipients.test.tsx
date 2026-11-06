import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

import { type Correspondent, RecipientRows, SUGGEST_DEBOUNCE_MS } from "./recipient-field";

afterEach(cleanup);

const settle = (ms = SUGGEST_DEBOUNCE_MS + 30) =>
  act(async () => await new Promise((r) => setTimeout(r, ms)));

function Harness(props: {
  initial?: { to?: string; cc?: string; bcc?: string };
  suggest: (q: string) => Promise<Correspondent[]>;
  onValue: (v: { to: string; cc: string; bcc: string }) => void;
}) {
  const [v, setV] = useState({ to: "", cc: "", bcc: "", ...props.initial });
  props.onValue(v);
  return (
    <TooltipProvider>
      <RecipientRows
        {...v}
        suggest={props.suggest}
        contacts={[{ name: "Bo Contact", email: "bo@contact.test" }]}
        onChange={(patch) => setV((s) => ({ ...s, ...patch }))}
      />
    </TooltipProvider>
  );
}

describe("recipient token inputs (specs/mail-v3.md §9, AC30)", () => {
  it("tokens, autocomplete, cc/bcc reveal", async () => {
    const queries: string[] = [];
    const people = [
      { name: "Ana Lima", email: "ana@acme.test", count: 12 },
      { name: "Andy Ng", email: "andy@x.test", count: 3 },
    ];
    let value = { to: "", cc: "", bcc: "" };
    render(
      <Harness
        suggest={async (q) => {
          queries.push(q);
          return people.filter((p) => p.name.toLowerCase().startsWith(q.toLowerCase()));
        }}
        onValue={(v) => (value = v)}
      />,
    );
    const to = screen.getByLabelText("To");

    // Typing asks the engine once, after the debounce, for what was typed.
    fireEvent.change(to, { target: { value: "a" } });
    fireEvent.change(to, { target: { value: "an" } });
    expect(queries).toEqual([]);
    await settle();
    expect(queries).toEqual(["an"]);
    const list = screen.getByRole("listbox", { name: "To suggestions" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Ana Limaana@acme.test", "Andy Ngandy@x.test"]);

    // Enter takes the highlighted suggestion as a named token.
    fireEvent.keyDown(to, { key: "ArrowDown" });
    fireEvent.keyDown(to, { key: "Enter" });
    expect(value.to).toBe("Andy Ng <andy@x.test>");
    screen.getByRole("button", { name: "Remove Andy Ng" });

    // A comma makes a token of a typed address.
    fireEvent.change(to, { target: { value: "dana@x.test," } });
    expect(value.to).toBe("Andy Ng <andy@x.test>, dana@x.test");
    expect((to as HTMLInputElement).value).toBe("");

    // Backspace on an empty input removes the last token.
    fireEvent.keyDown(to, { key: "Backspace" });
    expect(value.to).toBe("Andy Ng <andy@x.test>");

    // Contacts rank in without the engine.
    fireEvent.change(to, { target: { value: "bo" } });
    await settle();
    fireEvent.keyDown(to, { key: "Enter" });
    expect(value.to).toBe("Andy Ng <andy@x.test>, Bo Contact <bo@contact.test>");

    // Cc and Bcc appear on demand, with the same token input.
    expect(screen.queryByLabelText("Cc")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cc Bcc" }));
    const cc = screen.getByLabelText("Cc");
    screen.getByLabelText("Bcc");
    fireEvent.change(cc, { target: { value: "ana" } });
    await settle();
    fireEvent.keyDown(cc, { key: "Enter" });
    expect(value.cc).toBe("Ana Lima <ana@acme.test>");
  });

  it("a complete typed address stays what you typed, not a suggestion", async () => {
    let value = { to: "", cc: "", bcc: "" };
    const people = [
      { name: "Ana Lima", email: "ana@acme.com", count: 12 },
      { name: "Ann Lima", email: "ann@acme.com", count: 12 },
      { name: "Ann Co", email: "ann@acme.co", count: 2 },
    ];
    render(<Harness suggest={async () => people} onValue={(v) => (value = v)} />);
    const to = screen.getByLabelText("To");
    // "ana@acme.co" prefixes Ana Lima's ".com": Enter keeps the typed address.
    fireEvent.change(to, { target: { value: "ana@acme.co" } });
    await settle();
    screen.getByRole("listbox", { name: "To suggestions" });
    fireEvent.keyDown(to, { key: "Enter" });
    expect(value.to).toBe("ana@acme.co");

    // A suggestion with exactly that address is taken, name and all, even below the first.
    fireEvent.change(to, { target: { value: "ann@acme.co" } });
    await settle();
    fireEvent.keyDown(to, { key: "Enter" });
    expect(value.to).toBe("ana@acme.co, Ann Co <ann@acme.co>");

    // A partial address still takes the highlighted suggestion.
    fireEvent.change(to, { target: { value: "ana" } });
    await settle();
    fireEvent.keyDown(to, { key: "Enter" });
    expect(value.to).toBe("ana@acme.co, Ann Co <ann@acme.co>, Ana Lima <ana@acme.com>");
  });

  it("reply all keeps Cc: a filled Cc shows without the reveal", () => {
    render(
      <Harness
        initial={{ to: "ana@acme.test", cc: "Bo <bo@x.test>" }}
        suggest={async () => []}
        onValue={() => {}}
      />,
    );
    screen.getByLabelText("Cc");
    screen.getByRole("button", { name: "Remove Bo" });
    expect(screen.queryByRole("button", { name: "Cc Bcc" })).toBeNull();
  });
});
