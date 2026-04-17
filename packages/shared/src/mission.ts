import type { IssueStatus, MissionRequiredDocumentKey, MissionState } from "./constants.js";
import { MISSION_REQUIRED_DOCUMENT_KEYS } from "./constants.js";

export const MISSION_FINAL_REPORT_DOCUMENT_KEY = "mission-final-report";

export function getMissionValidationReportDocumentKey(round: number): `validation-report-round-${number}` {
  if (!Number.isInteger(round) || round < 1) {
    throw new Error("Mission validation report rounds must be positive integers.");
  }
  return `validation-report-round-${round}`;
}

export function getMissionMilestoneSummaryDocumentKey(slug: string): `milestone-summary-${string}` {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    throw new Error("Mission milestone summary slugs must be document-key-safe.");
  }
  return `milestone-summary-${normalized}`;
}

export function isMissionRequiredDocumentKey(value: string): value is MissionRequiredDocumentKey {
  return (MISSION_REQUIRED_DOCUMENT_KEYS as readonly string[]).includes(value);
}

export function isMissionDocumentKey(value: string): boolean {
  return (
    isMissionRequiredDocumentKey(value) ||
    value === MISSION_FINAL_REPORT_DOCUMENT_KEY ||
    /^validation-report-round-[1-9][0-9]*$/.test(value) ||
    /^milestone-summary-[a-z0-9][a-z0-9_-]*$/.test(value)
  );
}

export interface MissionStateDerivationInput {
  missionIssueStatus: IssueStatus;
  presentDocumentKeys: readonly string[];
  approvalRequired?: boolean;
  paused?: boolean;
  hasActiveFeatureIssues?: boolean;
  hasActiveValidationIssues?: boolean;
  hasActiveFixIssues?: boolean;
  hasBlockingFindings?: boolean;
}

export function deriveIssueBackedMissionState(input: MissionStateDerivationInput): MissionState {
  if (input.missionIssueStatus === "cancelled") return "cancelled";
  if (input.paused) return "paused";
  if (input.missionIssueStatus === "blocked" || input.hasBlockingFindings) return "blocked";

  const presentKeys = new Set(input.presentDocumentKeys);
  if (input.missionIssueStatus === "done" && presentKeys.has(MISSION_FINAL_REPORT_DOCUMENT_KEY)) {
    return "completed";
  }

  const hasMissionBrief = presentKeys.has("mission-brief");
  const hasValidationContract = presentKeys.has("validation-contract");
  const hasFeatures = presentKeys.has("features");

  if (!hasMissionBrief || !hasValidationContract) return "draft";
  if (input.approvalRequired) return "ready_for_approval";
  if (!hasFeatures) return "planning";
  if (input.hasActiveFixIssues) return "fixing";
  if (input.hasActiveValidationIssues) return "validating";
  if (input.hasActiveFeatureIssues) return "running";

  return "planning";
}
