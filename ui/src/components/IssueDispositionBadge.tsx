import type {
  IssueBlockerAttention,
  IssueExecutionDisposition,
  IssueExecutionHumanEscalationOwner,
  IssueExecutionLivePath,
  IssueExecutionRecoveryKind,
  IssueExecutionWaitingPath,
} from "@paperclipai/shared";
import {
  AlertOctagon,
  AlertTriangle,
  CircleDashed,
  Hourglass,
  Lock,
  Play,
  RotateCw,
  Wrench,
} from "lucide-react";
import { cn } from "../lib/utils";

export type IssueDispositionCategory =
  | "live"
  | "waiting"
  | "blocked_chain"
  | "resuming"
  | "recovery"
  | "needs_attention"
  | "invalid"
  | "terminal"
  | "resting";

const CATEGORY_LABEL: Record<IssueDispositionCategory, string> = {
  live: "Live",
  waiting: "Waiting",
  blocked_chain: "Blocked",
  resuming: "Resuming",
  recovery: "Recovery",
  needs_attention: "Needs attention",
  invalid: "Stalled",
  terminal: "Done",
  resting: "Resting",
};

const LIVE_PATH_LABEL: Record<IssueExecutionLivePath, string> = {
  active_run: "Active run",
  queued_wake: "Queued wake",
  scheduled_retry: "Scheduled retry",
  deferred_execution: "Deferred execution",
};

const WAITING_PATH_LABEL: Record<IssueExecutionWaitingPath, string> = {
  participant: "Review participant",
  interaction: "Interaction response",
  approval: "Board approval",
  human_owner: "Human owner",
  blocker_chain: "Blocker chain",
  pause_hold: "Tree paused",
  review_artifact: "Recovery work",
  external_owner_action: "External owner",
};

const RECOVERY_LABEL: Record<IssueExecutionRecoveryKind, string> = {
  dispatch: "Awaiting dispatch repair",
  continuation: "Awaiting continuation",
  repair_wait: "Repairing wait state",
};

const ESCALATION_VISIBLE_LABEL: Record<IssueExecutionHumanEscalationOwner, string> = {
  board: "Needs board",
  manager: "Needs manager",
  recovery_owner: "Needs owner",
  external: "Needs external",
};

const ESCALATION_DETAIL_LABEL: Record<IssueExecutionHumanEscalationOwner, string> = {
  board: "Board must act",
  manager: "Manager must act",
  recovery_owner: "Recovery owner must act",
  external: "External owner must act",
};

export function dispositionCategory(
  disposition: IssueExecutionDisposition | null | undefined,
): IssueDispositionCategory | null {
  if (!disposition) return null;
  switch (disposition.kind) {
    case "terminal":
      return "terminal";
    case "resting":
      return "resting";
    case "live":
      return "live";
    case "dispatchable":
      // Dispatchable is the system's "ready to wake" state — it's a transient bookkeeping signal,
      // not something the board needs to scan for. We surface no badge for it.
      return null;
    case "waiting":
      return disposition.path === "blocker_chain" ? "blocked_chain" : "waiting";
    case "agent_continuable":
      return "resuming";
    case "recoverable_by_control_plane":
      return "recovery";
    case "human_escalation_required":
      return "needs_attention";
    case "invalid":
      return "invalid";
    default:
      return null;
  }
}

export function dispositionDetailLabel(
  disposition: IssueExecutionDisposition | null | undefined,
): string | null {
  if (!disposition) return null;
  switch (disposition.kind) {
    case "live":
      return LIVE_PATH_LABEL[disposition.path];
    case "waiting":
      return WAITING_PATH_LABEL[disposition.path];
    case "recoverable_by_control_plane":
      return RECOVERY_LABEL[disposition.recovery];
    case "agent_continuable":
      return `Attempt ${disposition.continuationAttempt} of ${disposition.maxAttempts}`;
    case "human_escalation_required":
      return ESCALATION_DETAIL_LABEL[disposition.owner];
    case "invalid":
      return invalidReasonLabel(disposition.reason);
    default:
      return null;
  }
}

export function dispositionVisibleLabel(
  disposition: IssueExecutionDisposition | null | undefined,
  category: IssueDispositionCategory,
): string {
  if (disposition?.kind === "agent_continuable") {
    return `Resuming · ${disposition.continuationAttempt}/${disposition.maxAttempts}`;
  }
  if (disposition?.kind === "human_escalation_required") {
    return ESCALATION_VISIBLE_LABEL[disposition.owner];
  }
  return CATEGORY_LABEL[category];
}

function invalidReasonLabel(reason: string): string {
  switch (reason) {
    case "in_review_without_action_path":
      return "Review without action path";
    case "invalid_review_participant":
      return "Invalid review participant";
    case "blocked_by_invalid_issue":
      return "Blocked by invalid issue";
    case "blocked_by_cancelled_issue":
      return "Blocked by cancelled issue";
    case "blocked_by_unassigned_issue":
      return "Blocked by unassigned issue";
    case "blocked_by_resting_issue":
      return "Blocked by resting issue";
    case "blocked_without_action_path":
      return "Blocked without action path";
    case "dual_assignee":
      return "Dual assignee";
    default:
      return reason.replace(/_/g, " ");
  }
}

const CATEGORY_PILL: Record<IssueDispositionCategory, string> = {
  live: "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200",
  waiting: "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200",
  blocked_chain: "border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
  // Resuming is benign self-recovery — keep it muted (indigo) so it does not compete with sky/Waiting
  // or land in the rose alarm family alongside Recovery / Needs attention / Stalled.
  resuming: "border-indigo-300/70 bg-indigo-50 text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-200",
  recovery: "border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200",
  needs_attention: "border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200",
  // Stalled is the canary. Solid fill makes it the visual outlier in the rose family so a board
  // scanning the inbox spots it without reading the label.
  invalid: "border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-600 dark:text-white",
  terminal: "border-border bg-muted text-muted-foreground",
  resting: "border-border bg-muted text-muted-foreground",
};

const CATEGORY_ICON: Record<IssueDispositionCategory, React.ComponentType<{ className?: string }>> = {
  live: Play,
  waiting: Hourglass,
  blocked_chain: Lock,
  resuming: RotateCw,
  recovery: Wrench,
  needs_attention: AlertTriangle,
  invalid: AlertOctagon,
  terminal: CircleDashed,
  resting: CircleDashed,
};

export interface ShouldShowDispositionBadgeOptions {
  isExplicitWaiting?: boolean;
  blockerAttentionState?: IssueBlockerAttention["state"] | null;
}

export function shouldShowDispositionBadge(
  disposition: IssueExecutionDisposition | null | undefined,
  options: ShouldShowDispositionBadgeOptions = {},
): boolean {
  const category = dispositionCategory(disposition);
  if (!category) return false;
  if (category === "terminal" || category === "resting") return false;
  if (category === "waiting" && options.isExplicitWaiting) return false;
  if (category === "recovery" && options.blockerAttentionState === "recovery_needed") return false;
  return true;
}

export interface IssueDispositionBadgeProps {
  disposition: IssueExecutionDisposition | null | undefined;
  className?: string;
  hideLabel?: boolean;
  hideForResting?: boolean;
  hideForTerminal?: boolean;
}

export function IssueDispositionBadge({
  disposition,
  className,
  hideLabel = false,
  hideForResting = true,
  hideForTerminal = true,
}: IssueDispositionBadgeProps) {
  const category = dispositionCategory(disposition);
  if (!category) return null;
  if (hideForResting && category === "resting") return null;
  if (hideForTerminal && category === "terminal") return null;

  const detail = dispositionDetailLabel(disposition);
  const label = dispositionVisibleLabel(disposition, category);
  const Icon = CATEGORY_ICON[category];
  const tooltip = detail ? `${label} · ${detail}` : label;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        CATEGORY_PILL[category],
        className,
      )}
      title={tooltip}
      aria-label={tooltip}
      data-execution-disposition-kind={disposition?.kind}
      data-execution-disposition-category={category}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {hideLabel ? null : <span>{label}</span>}
    </span>
  );
}
