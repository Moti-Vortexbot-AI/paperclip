// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { IssueExecutionDisposition } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IssueDispositionBadge,
  dispositionCategory,
  shouldShowDispositionBadge,
} from "./IssueDispositionBadge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("IssueDispositionBadge", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function render(disposition: IssueExecutionDisposition | null) {
    const root = createRoot(container);
    act(() => {
      root.render(<IssueDispositionBadge disposition={disposition} />);
    });
    return root;
  }

  it("renders nothing for null disposition", () => {
    const root = render(null);
    expect(container.querySelector("[data-execution-disposition-kind]")).toBeNull();
    act(() => root.unmount());
  });

  it("renders nothing for terminal and resting kinds by default", () => {
    let root = render({ kind: "terminal" });
    expect(container.querySelector("[data-execution-disposition-kind]")).toBeNull();
    act(() => root.unmount());

    root = render({ kind: "resting" });
    expect(container.querySelector("[data-execution-disposition-kind]")).toBeNull();
    act(() => root.unmount());
  });

  it("renders nothing for dispatchable (transient bookkeeping signal)", () => {
    const root = render({ kind: "dispatchable", wakeTarget: "agent-1" });
    expect(container.querySelector("[data-execution-disposition-kind]")).toBeNull();
    act(() => root.unmount());
  });

  it("renders Live category for live disposition", () => {
    const root = render({ kind: "live", path: "active_run" });
    const badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge?.getAttribute("data-execution-disposition-kind")).toBe("live");
    expect(badge?.getAttribute("data-execution-disposition-category")).toBe("live");
    expect(badge?.textContent).toContain("Live");
    expect(badge?.getAttribute("title")).toContain("Active run");
    expect(badge?.getAttribute("aria-label")).toContain("Active run");
    act(() => root.unmount());
  });

  it("distinguishes blocked_chain from generic waiting", () => {
    const root = render({ kind: "waiting", path: "blocker_chain" });
    const badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge?.getAttribute("data-execution-disposition-category")).toBe("blocked_chain");
    expect(badge?.textContent).toContain("Blocked");
    act(() => root.unmount());
  });

  it("renders agent_continuable as Resuming with attempt counter on the visible label", () => {
    const root = render({ kind: "agent_continuable", continuationAttempt: 1, maxAttempts: 2 });
    const badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge?.getAttribute("data-execution-disposition-category")).toBe("resuming");
    expect(badge?.textContent).toContain("Resuming · 1/2");
    // muted indigo treatment, not rose
    expect(badge?.className).toContain("indigo");
    expect(badge?.className).not.toContain("rose");
    act(() => root.unmount());
  });

  it("differentiates human_escalation_required by owner in the visible label", () => {
    const owners = [
      { owner: "board", label: "Needs board" },
      { owner: "manager", label: "Needs manager" },
      { owner: "recovery_owner", label: "Needs owner" },
      { owner: "external", label: "Needs external" },
    ] as const;
    for (const { owner, label } of owners) {
      const root = render({ kind: "human_escalation_required", owner });
      const badge = container.querySelector("[data-execution-disposition-kind]");
      expect(badge?.getAttribute("data-execution-disposition-category")).toBe("needs_attention");
      expect(badge?.textContent).toContain(label);
      // shared rose family for the escalation category
      expect(badge?.className).toContain("rose");
      act(() => root.unmount());
    }
  });

  it("renders invalid (Stalled) with solid rose-600 fill so it stands out", () => {
    const root = render({
      kind: "invalid",
      reason: "in_review_without_action_path",
      suggestedCorrection: "fix it",
    });
    const badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge?.getAttribute("data-execution-disposition-category")).toBe("invalid");
    expect(badge?.textContent).toContain("Stalled");
    expect(badge?.getAttribute("title")).toContain("Review without action path");
    expect(badge?.className).toContain("bg-rose-600");
    expect(badge?.className).toContain("text-white");
    act(() => root.unmount());
  });

  it("dispositionCategory routes recovery and continuable to distinct categories", () => {
    expect(dispositionCategory({ kind: "recoverable_by_control_plane", recovery: "dispatch" })).toBe(
      "recovery",
    );
    expect(
      dispositionCategory({ kind: "agent_continuable", continuationAttempt: 1, maxAttempts: 2 }),
    ).toBe("resuming");
  });

  it("dispositionCategory returns null for dispatchable", () => {
    expect(dispositionCategory({ kind: "dispatchable", wakeTarget: "agent-1" })).toBeNull();
  });

  describe("shouldShowDispositionBadge", () => {
    it("returns false for null, terminal, resting, and dispatchable", () => {
      expect(shouldShowDispositionBadge(null)).toBe(false);
      expect(shouldShowDispositionBadge({ kind: "terminal" })).toBe(false);
      expect(shouldShowDispositionBadge({ kind: "resting" })).toBe(false);
      expect(shouldShowDispositionBadge({ kind: "dispatchable", wakeTarget: "a" })).toBe(false);
    });

    it("suppresses generic waiting when the explicit waiting pill is shown", () => {
      const waiting: IssueExecutionDisposition = { kind: "waiting", path: "interaction" };
      expect(shouldShowDispositionBadge(waiting, { isExplicitWaiting: true })).toBe(false);
      expect(shouldShowDispositionBadge(waiting, { isExplicitWaiting: false })).toBe(true);
    });

    it("suppresses recovery when the IssueBlockedNotice already shows recovery_needed copy", () => {
      const recovery: IssueExecutionDisposition = {
        kind: "recoverable_by_control_plane",
        recovery: "continuation",
      };
      expect(
        shouldShowDispositionBadge(recovery, { blockerAttentionState: "recovery_needed" }),
      ).toBe(false);
      expect(shouldShowDispositionBadge(recovery, { blockerAttentionState: "covered" })).toBe(true);
    });

    it("does not suppress resuming when blockerAttention is recovery_needed", () => {
      const resuming: IssueExecutionDisposition = {
        kind: "agent_continuable",
        continuationAttempt: 1,
        maxAttempts: 2,
      };
      expect(
        shouldShowDispositionBadge(resuming, { blockerAttentionState: "recovery_needed" }),
      ).toBe(true);
    });
  });
});
