import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  goals,
  heartbeatRuns,
  instanceSettings,
  issueRelations,
  issueThreadInteractions,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("issueThreadInteractionService", () => {
  let db!: ReturnType<typeof createDb>;
  let issuesSvc!: ReturnType<typeof issueService>;
  let interactionsSvc!: ReturnType<typeof issueThreadInteractionService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-thread-interactions-");
    db = createDb(tempDb.connectionString);
    issuesSvc = issueService(db);
    interactionsSvc = issueThreadInteractionService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueThreadInteractions);
    await db.delete(issueRelations);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("accepts suggested tasks by creating a rooted issue tree under the current issue", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const assigneeAgentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Persist thread interactions",
      level: "task",
      status: "active",
    });
    await db.insert(agents).values({
      id: assigneeAgentId,
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
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      requestDepth: 2,
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "suggest_tasks",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        tasks: [
          {
            clientKey: "root",
            title: "Create the root follow-up",
            assigneeAgentId,
          },
          {
            clientKey: "child",
            parentClientKey: "root",
            title: "Create the nested follow-up",
          },
        ],
      },
    }, {
      userId: "local-board",
    });

    expect(created.status).toBe("pending");

    const accepted = await interactionsSvc.acceptSuggestedTasks({
      id: issueId,
      companyId,
      goalId,
      projectId: null,
    }, created.id, {}, {
      userId: "local-board",
    });

    expect(accepted.interaction.kind).toBe("suggest_tasks");
    expect(accepted.interaction.status).toBe("accepted");
    expect(accepted.interaction.result).toMatchObject({
      version: 1,
      createdTasks: [
        expect.objectContaining({ clientKey: "root", parentIssueId: issueId }),
        expect.objectContaining({ clientKey: "child" }),
      ],
    });
    expect(accepted.createdIssues).toEqual([
      expect.objectContaining({
        assigneeAgentId,
        status: "todo",
      }),
      expect.objectContaining({
        assigneeAgentId: null,
        status: "todo",
      }),
    ]);

    const children = await issuesSvc.list(companyId, { parentId: issueId });
    expect(children).toHaveLength(1);
    expect(children[0]?.title).toBe("Create the root follow-up");

    const nestedChildren = await issuesSvc.list(companyId, { parentId: children[0]!.id });
    expect(nestedChildren).toHaveLength(1);
    expect(nestedChildren[0]?.title).toBe("Create the nested follow-up");
    expect(nestedChildren[0]?.requestDepth).toBe(4);

    const listed = await interactionsSvc.listForIssue(issueId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("accepted");
  });

  it("accepts a selected subset of suggested tasks and records the skipped drafts", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Selectively persist thread interactions",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
      requestDepth: 2,
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "suggest_tasks",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        tasks: [
          {
            clientKey: "root",
            title: "Create the root follow-up",
          },
          {
            clientKey: "child",
            parentClientKey: "root",
            title: "Create the nested follow-up",
          },
          {
            clientKey: "sibling",
            title: "Create the sibling follow-up",
          },
        ],
      },
    }, {
      userId: "local-board",
    });

    const accepted = await interactionsSvc.acceptSuggestedTasks({
      id: issueId,
      companyId,
      goalId,
      projectId: null,
    }, created.id, {
      selectedClientKeys: ["root"],
    }, {
      userId: "local-board",
    });

    expect(accepted.interaction.result).toMatchObject({
      version: 1,
      createdTasks: [
        expect.objectContaining({ clientKey: "root", parentIssueId: issueId }),
      ],
      skippedClientKeys: ["child", "sibling"],
    });

    const children = await issuesSvc.list(companyId, { parentId: issueId });
    expect(children).toHaveLength(1);
    expect(children[0]?.title).toBe("Create the root follow-up");
  });

  it("rejects partial acceptance when a selected task omits its selected-tree parent", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Validate selective acceptance",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "suggest_tasks",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        tasks: [
          {
            clientKey: "root",
            title: "Create the root follow-up",
          },
          {
            clientKey: "child",
            parentClientKey: "root",
            title: "Create the nested follow-up",
          },
        ],
      },
    }, {
      userId: "local-board",
    });

    await expect(
      interactionsSvc.acceptSuggestedTasks({
        id: issueId,
        companyId,
        goalId,
        projectId: null,
      }, created.id, {
        selectedClientKeys: ["child"],
      }, {
        userId: "local-board",
      }),
    ).rejects.toThrow("requires its parent");
  });

  it("persists validated answers for ask_user_questions interactions", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Persist question answers",
      level: "task",
      status: "active",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      goalId,
      title: "Question parent",
      status: "todo",
      priority: "medium",
    });

    const created = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, {
      kind: "ask_user_questions",
      continuationPolicy: "wake_assignee",
      payload: {
        version: 1,
        questions: [
          {
            id: "scope",
            prompt: "Choose the scope",
            selectionMode: "single",
            required: true,
            options: [
              { id: "phase-1", label: "Phase 1" },
              { id: "phase-2", label: "Phase 2" },
            ],
          },
          {
            id: "extras",
            prompt: "Optional extras",
            selectionMode: "multi",
            options: [
              { id: "tests", label: "Tests" },
              { id: "docs", label: "Docs" },
            ],
          },
        ],
      },
    }, {
      userId: "local-board",
    });

    const answered = await interactionsSvc.answerQuestions({
      id: issueId,
      companyId,
    }, created.id, {
      answers: [
        { questionId: "scope", optionIds: ["phase-1"] },
        { questionId: "extras", optionIds: ["docs", "tests", "docs"] },
      ],
      summaryMarkdown: "Ship Phase 1 with tests and docs.",
    }, {
      userId: "local-board",
    });

    expect(answered.status).toBe("answered");
    expect(answered.result).toEqual({
      version: 1,
      answers: [
        { questionId: "scope", optionIds: ["phase-1"] },
        { questionId: "extras", optionIds: ["docs", "tests"] },
      ],
      summaryMarkdown: "Ship Phase 1 with tests and docs.",
    });
  });

  it("reuses the existing interaction when the same idempotency key is submitted twice", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();
    const issueId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: false });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Interaction dedupe",
      level: "task",
      status: "active",
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
      goalId,
      title: "Parent issue",
      status: "in_progress",
      priority: "medium",
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "manual",
      status: "running",
      startedAt: new Date("2026-04-20T12:00:00.000Z"),
    });

    const input = {
      kind: "ask_user_questions" as const,
      idempotencyKey: "run-1:questionnaire",
      sourceRunId: runId,
      continuationPolicy: "wake_assignee" as const,
      payload: {
        version: 1 as const,
        questions: [
          {
            id: "scope",
            prompt: "Pick a scope",
            selectionMode: "single" as const,
            options: [{ id: "phase-2", label: "Phase 2" }],
          },
        ],
      },
    };

    const first = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, input, {
      agentId,
    });

    const second = await interactionsSvc.create({
      id: issueId,
      companyId,
    }, input, {
      agentId,
    });

    expect(second.id).toBe(first.id);
    expect(second.sourceRunId).toBe(runId);

    const rows = await db.select().from(issueThreadInteractions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toBe("run-1:questionnaire");
  });
});
