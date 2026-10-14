import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import QuoteItemComposer from "./QuoteItemComposer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mountCake(servingSize: string) {
  act(() => {
    root.render(
      <QuoteItemComposer
        initial={{ product_type: "cake", details: { cake_flavor: "Chocolate", serving_size: servingSize } }}
        submitLabel="Save item"
        submitting={false}
        onSubmit={vi.fn()}
      />
    );
  });
}

// The composer's serving select carries no name attribute (and must not gain one —
// it is rendered inside QuoteModal's form), so find it by its bucket options.
function servingSelect(): HTMLSelectElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === "20-30")
    ) ?? null
  );
}

describe("QuoteItemComposer serving size", () => {
  it("offers the bucket options for a stored bucket value", () => {
    mountCake("20-30");
    const select = servingSelect();
    expect(select).not.toBeNull();
    expect(select!.value).toBe("20-30");
  });

  it("renders an exact wizard count as selected instead of blank", () => {
    mountCake("25");
    const select = servingSelect();
    expect(select).not.toBeNull();
    expect(select!.value).toBe("25");
    expect(Array.from(select!.options).some((o) => o.value === "25")).toBe(true);
  });

  it("does not duplicate an option when the value is a bucket", () => {
    mountCake("10-12");
    const select = servingSelect();
    const tens = Array.from(select!.options).filter((o) => o.value === "10-12");
    expect(tens).toHaveLength(1);
  });
});
