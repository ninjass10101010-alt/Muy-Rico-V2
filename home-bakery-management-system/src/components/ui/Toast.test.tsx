import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider, useToast } from "./Toast";

function TestConsumer() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success("Saved!")}>show success</button>
      <button onClick={() => toast.error("Failed!")}>show error</button>
    </div>
  );
}

function renderToast() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
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

function findToastButton(container: HTMLElement, message: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(message));
  expect(btn).toBeTruthy();
  return btn!;
}

describe("Toast", () => {
  it("renders an aria-live region", () => {
    const { container, root } = renderToast();
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    cleanup(root, container);
  });

  it("shows a success toast", () => {
    const { container, root } = renderToast();
    clickByText(container, "show success");
    expect(container.textContent).toContain("Saved!");
    cleanup(root, container);
  });

  it("shows an error toast", () => {
    const { container, root } = renderToast();
    clickByText(container, "show error");
    expect(container.textContent).toContain("Failed!");
    cleanup(root, container);
  });

  it("stacks multiple toasts", () => {
    const { container, root } = renderToast();
    clickByText(container, "show success");
    clickByText(container, "show error");
    expect(container.textContent).toContain("Saved!");
    expect(container.textContent).toContain("Failed!");
    cleanup(root, container);
  });

  it("auto-dismisses after 3.5 seconds", () => {
    vi.useFakeTimers();
    const { container, root } = renderToast();
    clickByText(container, "show success");
    expect(container.textContent).toContain("Saved!");
    act(() => {
      vi.advanceTimersByTime(3600);
    });
    expect(container.textContent).not.toContain("Saved!");
    cleanup(root, container);
    vi.useRealTimers();
  });

  it("dismisses when clicked", () => {
    const { container, root } = renderToast();
    clickByText(container, "show success");
    const toastButton = findToastButton(container, "Saved!");
    act(() => toastButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).not.toContain("Saved!");
    cleanup(root, container);
  });
});
