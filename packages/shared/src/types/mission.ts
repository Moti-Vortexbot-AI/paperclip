import type {
  MissionFeatureKind,
  MissionFeatureStatus,
  MissionFindingSeverity,
  MissionFindingStatus,
  MissionRoleType,
  MissionState,
  MissionValidationAssertionStatus,
  MissionValidationTooling,
} from "../constants.js";

export interface MissionEvidenceRequirement {
  kind: string;
  description: string;
  required: boolean;
}

export interface MissionValidationAssertion {
  id: string;
  title: string;
  user_value: string;
  scope: string;
  setup: string;
  steps: string[];
  oracle: string;
  tooling: MissionValidationTooling[];
  evidence: MissionEvidenceRequirement[];
  claimed_by: string[];
  status: MissionValidationAssertionStatus;
}

export interface MissionValidationContract {
  assertions: MissionValidationAssertion[];
}

export interface MissionFeature {
  id: string;
  title: string;
  kind: MissionFeatureKind;
  summary: string;
  acceptance_criteria: string[];
  claimed_assertion_ids: string[];
  status: MissionFeatureStatus;
  source_finding_id?: string | null;
}

export interface MissionMilestone {
  id: string;
  title: string;
  summary: string;
  features: MissionFeature[];
}

export interface MissionFeaturesDocument {
  milestones: MissionMilestone[];
}

export interface MissionFinding {
  id: string;
  severity: MissionFindingSeverity;
  assertion_id?: string | null;
  title: string;
  evidence: string[];
  repro_steps: string[];
  expected: string;
  actual: string;
  suspected_area?: string | null;
  recommended_fix_scope?: string | null;
  status: MissionFindingStatus;
}

export interface MissionValidationReport {
  round: number;
  validator_role: Extract<MissionRoleType, "scrutiny_validator" | "user_testing_validator">;
  summary: string;
  findings: MissionFinding[];
}

export interface IssueBackedMissionSummary {
  state: MissionState;
  missing_required_document_keys: string[];
  next_action: string;
}

export type MissionGeneratedIssueKind = "milestone" | "feature" | "validation" | "fix_loop";

export interface MissionDecomposedIssue {
  kind: MissionGeneratedIssueKind;
  key: string;
  issueId: string;
  identifier: string | null;
  title: string;
  created: boolean;
  blockedByIssueIds: string[];
}

export interface MissionDecompositionResult {
  missionIssueId: string;
  milestoneCount: number;
  featureCount: number;
  validationCount: number;
  fixLoopCount: number;
  createdIssueIds: string[];
  updatedIssueIds: string[];
  issues: MissionDecomposedIssue[];
}
