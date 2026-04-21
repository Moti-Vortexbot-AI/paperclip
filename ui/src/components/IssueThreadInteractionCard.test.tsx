// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueThreadInteractionCard } from "./IssueThreadInteractionCard";
import { ThemeProvider } from "../context/ThemeContext";
import { TooltipProvider } from "./ui/tooltip";
import {
  pendingAskUserQuestionsInteraction,
  pendingRequestConfirmationInteraction,
  pendingSuggestedTasksInteraction,
  staleTargetRequestConfirmationInteraction,
  rejectedSuggestedTasksInteraction,
} from "../fixtures/issueThreadInteractionFixtures";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

function renderCard(
  props: Partial<ComponentProps<typeof IssueThreadInteractionCard>> = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <TooltipProvider>
        <ThemeProvider>
          <IssueThreadInteractionCard
            interaction={pendingAskUserQuestionsInteraction}
            {...props}
          />
        </ThemeProvider>
      </TooltipProvider>,
    );
  });

  return container;
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe("IssueThreadInteractionCard", () => {
  it("exposes pending question options as selectable radio and checkbox controls", () => {
    const host = renderCard({
      interaction: pendingAskUserQuestionsInteraction,
      onSubmitInteractionAnswers: vi.fn(),
    });

    const singleGroup = host.querySelector('[role="radiogroup"]');
    expect(singleGroup?.getAttribute("aria-labelledby")).toBe(
      "interaction-questions-default-collapse-depth-prompt",
    );

    const radios = [...host.querySelectorAll('[role="radio"]')];
    expect(radios).toHaveLength(2);
    expect(radios[0]?.getAttribute("aria-checked")).toBe("false");

    act(() => {
      (radios[0] as HTMLButtonElement).click();
    });

    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
    expect(radios[1]?.getAttribute("aria-checked")).toBe("false");

    const multiGroup = host.querySelector('[role="group"]');
    expect(multiGroup?.getAttribute("aria-labelledby")).toBe(
      "interaction-questions-default-post-submit-summary-prompt",
    );
    expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(3);
  });

  it("makes child tasks explicit in suggested task trees", () => {
    const host = renderCard({
      interaction: pendingSuggestedTasksInteraction,
    });

    expect(host.textContent).toContain("Child task");
  });

  it("shows an explicit placeholder when a rejected interaction has no reason", () => {
    const host = renderCard({
      interaction: {
        ...rejectedSuggestedTasksInteraction,
        result: { version: 1 },
      },
    });

    expect(host.textContent).toContain("No reason provided.");
  });

  it("requires a decline reason when the request confirmation payload asks for one", async () => {
    const onRejectInteraction = vi.fn(async () => undefined);
    const host = renderCard({
      interaction: pendingRequestConfirmationInteraction,
      onRejectInteraction,
    });

    const declineButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Request revisions"),
    );
    expect(declineButton).toBeTruthy();

    await act(async () => {
      declineButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saveButton = Array.from(host.querySelectorAll("button")).filter((button) =>
      button.textContent?.includes("Request revisions"),
    ).at(-1);
    expect(saveButton?.hasAttribute("disabled")).toBe(true);
    expect(host.textContent).toContain("A decline reason is required.");

    const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, "Needs a smaller phase split");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const enabledSaveButton = Array.from(host.querySelectorAll("button")).filter((button) =>
      button.textContent?.includes("Request revisions"),
    ).at(-1);
    expect(enabledSaveButton?.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      enabledSaveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRejectInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "request_confirmation" }),
      "Needs a smaller phase split",
    );
  });

  it("invokes the confirm callback with pending request confirmations", async () => {
    const onAcceptInteraction = vi.fn(async () => undefined);
    const host = renderCard({
      interaction: pendingRequestConfirmationInteraction,
      onAcceptInteraction,
    });

    const confirmButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Approve plan"),
    );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAcceptInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "request_confirmation" }),
    );
  });

  it("renders request confirmation target links and stale-target expiry", () => {
    const host = renderCard({
      interaction: staleTargetRequestConfirmationInteraction,
    });

    const targetLink = host.querySelector("a");
    expect(host.textContent).toContain("Expired by target change");
    expect(host.textContent).toContain("Document: plan rev 3");
    expect(targetLink?.getAttribute("href")).toContain("#document-plan");
    expect(host.textContent).not.toContain("Approve plan");
  });
});
