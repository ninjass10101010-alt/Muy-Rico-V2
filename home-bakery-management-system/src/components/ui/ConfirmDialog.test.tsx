import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider, useConfirm } from "./ConfirmDialog";

function TestConsumer({ onResult }: { onResult: (ok: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <div>
      <button
        onClick={() => {
          void confirm({
            title: "Remove flour?",
            message: "It is used in Bolillos.",
            confirmLabel: "Remove",
            danger: true,
          }).then(onResult);
        }}
      >
        open danger
      </button>
      <button
        onClick={() => {
          void confirm({ title: "Switch group?", message: "Every product will switch." }).then(onResult);
        }}
      >
        open plain
      </button>
    </div>
  );
}

function renderConfirm(onResult: (ok: boolean) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ConfirmProvider>
        <TestConsumer onResult={onResult} />
      </ConfirmProvider>,
    ),
  );
  return { container, root };
}

function cleanup(root: ReturnType<typeof createRoot>, container: HTMLElement) {
  act(() => root.unmount());
  container.remove();
}

function clickByText(container: HTMLElement, text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  expect(btn).toBeTruthy();
  act(() => btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ConfirmDialog", () => {
  it("renders the title and message when opened", () => {
    const { container, root } = renderConfirm(() => {});
    clickByText(container, "open plain");
    expect(container.textContent).toContain("Switch group?");
    expect(container.textContent).toContain("Every product will switch.");
    cleanup(root, container);
  });

  it("uses Confirm and Cancel labels by default", () => {
    const { container, root } = renderConfirm(() => {});
    clickByText(container, "open plain");
    expect(container.textContent).toContain("Confirm");
    expect(container.textContent).toContain("Cancel");
    cleanup(root, container);
  });

  it("applies danger styling to the confirm button", () => {
    const { container, root } = renderConfirm(() => {});
    clickByText(container, "open danger");
    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Remove",
    );
    expect(confirmButton?.className).toContain("bg-hibiscus");
    cleanup(root, container);
  });

  it("resolves true when confirmed", async () => {
    const results: boolean[] = [];
    const { container, root } = renderConfirm((ok) => results.push(ok));
    clickByText(container, "open danger");
    clickByText(container, "Remove");
    await flush();
    expect(results).toEqual([true]);
    expect(container.textContent).not.toContain("It is used in Bolillos.");
    cleanup(root, container);
  });

  it("resolves false when cancelled", async () => {
    const results: boolean[] = [];
    const { container, root } = renderConfirm((ok) => results.push(ok));
    clickByText(container, "open danger");
    clickByText(container, "Cancel");
    await flush();
    expect(results).toEqual([false]);
    expect(container.textContent).not.toContain("It is used in Bolillos.");
    cleanup(root, container);
  });

  it("resolves false when the close button is used", async () => {
    const results: boolean[] = [];
    const { container, root } = renderConfirm((ok) => results.push(ok));
    clickByText(container, "open danger");
    const closeButton = container.querySelector("h3")?.parentElement?.querySelector("button");
    expect(closeButton).toBeTruthy();
    act(() => closeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();
    expect(results).toEqual([false]);
    cleanup(root, container);
  });
});
