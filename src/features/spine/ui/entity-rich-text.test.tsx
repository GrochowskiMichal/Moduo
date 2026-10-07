// DF-23 — the read-only renderer must (a) show foreign/legacy plain text
// verbatim (never parse untrusted mirror data as markup), and (b) turn our html
// into clickable chips that deep-link via `moduo:entity:open`.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { EntityRichText } from "./entity-rich-text";

afterEach(cleanup);

describe("EntityRichText", () => {
  it("renders foreign/legacy plain text verbatim, without parsing markup", () => {
    render(<EntityRichText html={"x < y and a <tag> stays literal"} />);
    expect(screen.getByText("x < y and a <tag> stays literal")).toBeTruthy();
  });

  it("renders our html with a chip that deep-links on click", () => {
    const spy = rs.fn();
    window.addEventListener("moduo:entity:open", spy as EventListener);
    render(
      <EntityRichText
        html={
          '<p>Call <span data-lexical-entity-ref="true" data-entity-type="contact" data-entity-id="c-9">Acme</span> today</p>'
        }
      />,
    );

    const chip = screen.getByRole("button", { name: /contact: Acme/i });
    fireEvent.click(chip);

    expect(spy).toHaveBeenCalledTimes(1);
    const evt = spy.mock.calls[0][0] as CustomEvent;
    expect(evt.detail).toEqual({ type: "contact", id: "c-9" });
    window.removeEventListener("moduo:entity:open", spy as EventListener);
  });

  it("drops disallowed elements instead of rendering their source as text", () => {
    render(<EntityRichText html={"<p>safe<script>alert(1)</script></p>"} />);
    expect(screen.queryByText(/alert\(1\)/)).toBeNull();
    expect(screen.getByText("safe")).toBeTruthy();
  });
});
