import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  documentRevisions,
  documents,
  issueComments,
  issueDocuments,
  issueRelations,
  issues,
} from "@paperclipai/db";
import { MISSION_REQUIRED_DOCUMENT_KEYS } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { documentService } from "../services/documents.js";
import { missionInitializationService } from "../services/mission-initialization.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres mission initialization tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("missionInitializationService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-mission-init-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedIssue() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Mission: initialize issue state",
      description: "Create a mission state bundle.",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      issueNumber: 1532,
      identifier: "TST-1532",
    });
    return { companyId, agentId, issueId };
  }

  it("creates required mission documents once and sets mission metadata", async () => {
    const { agentId, issueId } = await seedIssue();
    const service = missionInitializationService(db);

    const first = await service.initialize(issueId, {
      actor: { agentId },
    });

    expect(first.createdDocumentKeys).toEqual([...MISSION_REQUIRED_DOCUMENT_KEYS]);
    expect(first.existingDocumentKeys).toEqual([]);
    expect(first.metadataUpdated).toBe(true);
    expect(first.originKind).toBe("mission");
    expect(first.originId).toBe("TST-1532");
    expect(first.billingCode).toBe("mission:TST-1532");
    expect(first.commentId).toBeTruthy();

    const docsAfterFirst = await documentService(db).listIssueDocuments(issueId);
    expect(docsAfterFirst.map((document) => document.key).sort()).toEqual([...MISSION_REQUIRED_DOCUMENT_KEYS].sort());
    expect(docsAfterFirst.every((document) => document.latestRevisionNumber === 1)).toBe(true);

    const second = await service.initialize(issueId, {
      actor: { agentId },
    });

    expect(second.createdDocumentKeys).toEqual([]);
    expect(second.existingDocumentKeys).toEqual([...MISSION_REQUIRED_DOCUMENT_KEYS]);
    expect(second.metadataUpdated).toBe(false);
    expect(second.commentId).toBeNull();

    const docsAfterSecond = await documentService(db).listIssueDocuments(issueId);
    expect(docsAfterSecond).toHaveLength(MISSION_REQUIRED_DOCUMENT_KEYS.length);
    expect(docsAfterSecond.every((document) => document.latestRevisionNumber === 1)).toBe(true);

    const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, issueId));
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("Mission initialized");
  });

  it("preserves existing user-authored mission documents", async () => {
    const { agentId, issueId } = await seedIssue();
    await documentService(db).upsertIssueDocument({
      issueId,
      key: "validation-contract",
      title: "Validation Contract",
      format: "markdown",
      body: "# Custom validation contract",
      changeSummary: "User-authored contract",
      baseRevisionId: null,
      createdByAgentId: agentId,
    });

    const result = await missionInitializationService(db).initialize(issueId, {
      actor: { agentId },
    });

    expect(result.createdDocumentKeys).not.toContain("validation-contract");
    expect(result.existingDocumentKeys).toContain("validation-contract");
    const preserved = await documentService(db).getIssueDocumentByKey(issueId, "validation-contract");
    expect(preserved?.body).toBe("# Custom validation contract");
    expect(preserved?.latestRevisionNumber).toBe(1);
  });
});
