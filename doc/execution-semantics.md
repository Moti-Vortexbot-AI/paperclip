# Execution Semantics

Status: Current implementation guide
Date: 2026-04-29
Audience: Product and engineering

This document explains how Paperclip interprets issue assignment, issue status, execution runs, wakeups, parent/sub-issue structure, and blocker relationships.

`doc/SPEC-implementation.md` remains the V1 contract. This document is the detailed execution model behind that contract.

## 1. Core Model

Paperclip separates four concepts that are easy to blur together:

1. structure: parent/sub-issue relationships
2. dependency: blocker relationships
3. ownership: who is responsible for the issue now
4. execution: whether the control plane currently has a live path to move the issue forward

The system works best when those are kept separate.

## 2. Assignee Semantics

An issue has at most one assignee.

- `assigneeAgentId` means the issue is owned by an agent
- `assigneeUserId` means the issue is owned by a human board user
- both cannot be set at the same time

This is a hard invariant. Paperclip is single-assignee by design.

## 3. Status Semantics

Paperclip issue statuses are not just UI labels. They imply different expectations about ownership and execution.

### `backlog`

The issue is not ready for active work.

- no execution expectation
- no pickup expectation
- safe resting state for future work

### `todo`

The issue is actionable but not actively claimed.

- it may be assigned or unassigned
- no checkout/execution lock is required yet
- for agent-assigned work, Paperclip may still need a wake path to ensure the assignee actually sees it

### `in_progress`

The issue is actively owned work.

- requires an assignee
- for agent-owned issues, this is a strict execution-backed state
- for user-owned issues, this is a human ownership state and is not backed by heartbeat execution

For agent-owned issues, `in_progress` should not be allowed to become a silent dead state.

### `blocked`

The issue cannot proceed until something external changes.

This is the right state for:

- waiting on another issue
- waiting on a human decision
- waiting on an external dependency or system
- work that automatic recovery could not safely continue

### `in_review`

Execution work is paused because the next move belongs to a reviewer or approver, not the current executor.

### `done`

The work is complete and terminal.

### `cancelled`

The work will not continue and is terminal.

## 4. Agent-Owned vs User-Owned Execution

The execution model differs depending on assignee type.

### Agent-owned issues

Agent-owned issues are part of the control plane's execution loop.

- Paperclip can wake the assignee
- Paperclip can track runs linked to the issue
- Paperclip can recover some lost execution state after crashes/restarts

### User-owned issues

User-owned issues are not executed by the heartbeat scheduler.

- Paperclip can track the ownership and status
- Paperclip cannot rely on heartbeat/run semantics to keep them moving
- stranded-work reconciliation does not apply to them

This is why `in_progress` can be strict for agents without forcing the same runtime rules onto human-held work.

## 5. Checkout and Active Execution

Checkout is the bridge from issue ownership to active agent execution.

- checkout is required to move an issue into agent-owned `in_progress`
- `checkoutRunId` represents issue-ownership lock for the current agent run
- `executionRunId` represents the currently active execution path for the issue

These are related but not identical:

- `checkoutRunId` answers who currently owns execution rights for the issue
- `executionRunId` answers which run is actually live right now

Paperclip already clears stale execution locks and can adopt some stale checkout locks when the original run is gone.

## 6. Parent/Sub-Issue vs Blockers

Paperclip uses two different relationships for different jobs.

### Parent/Sub-Issue (`parentId`)

This is structural.

Use it for:

- work breakdown
- rollup context
- explaining why a child issue exists
- waking the parent assignee when all direct children become terminal

Do not treat `parentId` as execution dependency by itself.

### Blockers (`blockedByIssueIds`)

This is dependency semantics.

Use it for:

- \"this issue cannot continue until that issue changes state\"
- explicit waiting relationships
- automatic wakeups when all blockers resolve

Blocked issues should stay idle while blockers remain unresolved. Paperclip should not create a queued heartbeat run for that issue until the final blocker is done and the `issue_blockers_resolved` wake can start real work.

If a parent is truly waiting on a child, model that with blockers. Do not rely on the parent/child relationship alone.

## 7. Non-Terminal Issue Liveness Contract

For agent-owned, non-terminal issues, Paperclip should never leave work in a state where nobody is responsible for the next move and nothing will wake or surface it.

This is a visibility contract, not an auto-completion contract. If Paperclip cannot safely infer the next action, it should surface the ambiguity with a blocked state, a visible comment, or an explicit recovery issue. It must not silently mark work done from prose comments or guess that a dependency is complete.

An issue is healthy when the product can answer "what moves this forward next?" without requiring a human to reconstruct intent from the whole thread. An issue is stalled when it is non-terminal but has no live execution path, no explicit waiting path, and no recovery path.

The valid action-path primitives are:

- an active run linked to the issue
- a queued wake or continuation that can be delivered to the responsible agent
- a scheduled retry or deferred issue-execution wake that is tied to the issue
- an active subtree pause hold that intentionally suppresses execution for the issue
- a typed execution-policy participant, such as `executionState.currentParticipant`
- a pending issue-thread interaction or linked approval that is waiting for a specific responder and is fresh or tied to a resolvable human owner
- a human owner via `assigneeUserId`
- a first-class blocker chain whose unresolved leaf issues are themselves healthy
- an open explicit recovery issue that names the owner and action needed to restore liveness

Run progress and issue liveness are separate questions. A finished heartbeat can prove that the agent did useful work during that run, but the finished run is not itself a live path for a non-terminal agent-owned issue. After a heartbeat exits, a non-terminal issue must still have a terminal state, explicit waiting path, explicit live path, or recovery/review path.

Pending issue-thread interactions and linked pending approvals are status-independent waiting primitives: they can keep a `todo` or `in_progress` issue healthy if they clearly name the responder and continuation policy, and the wait is either fresh or tied to a resolvable human owner. Stale agent-authored or ownerless waits are not durable liveness coverage; recovery should treat them as stalled or recovery-needed instead of suppressing watchdog surfaces indefinitely. Agents should still move the source issue to `in_review` when they create a plan confirmation, question, or other board/user decision card, because `in_review` is the visible posture that tells operators execution is intentionally paused rather than abandoned.

### Canonical execution dispositions

Issue status is the user-facing posture. It is not the whole execution state machine. For agent-owned non-terminal issues, Paperclip must derive exactly one canonical execution disposition from the state vector after each write, heartbeat, recovery scan, and read-model classification.

The canonical dispositions are:

| Disposition | Meaning | Healthy resting state? | Required handling |
|---|---|---:|---|
| `terminal` | The issue is `done` or `cancelled`. | yes | No execution or recovery expected. |
| `resting` | The issue is intentionally not executable yet, normally `backlog`. | yes | Do not wake or recover until status/owner changes. |
| `dispatchable` | The issue can be delivered to an invokable agent. | yes, briefly | Ensure a wake path exists or can be enqueued. |
| `live` | An active run, queued wake, scheduled retry, or deferred execution owns the next move. | yes | Preserve the live path and avoid duplicate wakes. |
| `waiting` | A typed participant, pending interaction, linked approval, human owner, active pause hold, healthy blocker chain, watchdog/recovery issue, or productivity review owns the next move. | yes | Surface the wait owner/action; do not auto-run the source while the wait is valid. |
| `recoverable_by_control_plane` | The control plane can safely repair lost execution continuity without choosing product intent. | transitional | Queue one bounded dispatch/continuation/repair wake, or create/reuse the approved recovery artifact. |
| `agent_continuable` | The assigned agent can be asked, within bounded continuation rules, to convert useful output or a runnable next action into durable issue state. | transitional | Queue a deduped continuation if attempts remain and no hold/gate suppresses it. |
| `human_escalation_required` | A board user, manager, approver, external owner, or explicit recovery owner must decide before work can lawfully move. | transitional or waiting when represented by an owned issue/interaction | Create or reuse one visible review/recovery/unblock artifact and block or move the source only when that wait is real. |
| `invalid` | The proposed or stored state has no lawful next action. | no | Reject at the API boundary, normalize before commit, or convert to visible recovery/escalation work. |

`terminal`, `resting`, `dispatchable`, `live`, and `waiting` are stable classifications. `recoverable_by_control_plane`, `agent_continuable`, `human_escalation_required`, and `invalid` are action classifications: they must lead to a queued wake, explicit artifact, rejected write, normalized state, or visible blocker/recovery comment rather than quietly remaining as stale data.

The classifier input is a state vector, not a single field. The vector includes:

- work posture: issue status
- owner: agent, human user, unassigned, or invalid dual owner
- agent invokability: active, idle, running, error, paused, terminated, pending approval, or budget-blocked
- execution path: active run, queued wake, scheduled retry, deferred issue execution, checkout lock, execution lock
- explicit wait path: execution-policy participant, issue-thread interaction, linked approval, human owner, active pause hold
- dependency path: blockers and the first unresolved leaf disposition
- run evidence: latest issue-linked run status, run liveness classification, continuation attempt count, and next-action extraction
- recovery path: open explicit recovery issue, watchdog issue, productivity review hold, previous automatic recovery attempt
- governance gates: board approval requirements, permissions, company boundary, budget hard stop, subtree pause/cancel hold

### State-vector matrix

Use this matrix as the product contract for table-driven classifier tests. Rows are ordered by precedence: earlier rows win when multiple signals are present.

| Row | Status posture | Owner vector | Action, wait, dependency, or gate vector | Canonical disposition | Handling contract |
|---|---|---|---|---|---|
| 1 | `done` or `cancelled` | any valid owner state | terminal status is set | `terminal` | Do not dispatch or recover. |
| 2 | any | both `assigneeAgentId` and `assigneeUserId` set | dual owner violates the single-assignee invariant | `invalid` | Reject or normalize before persistence. |
| 3 | `backlog` | unassigned or assigned | no active execution expectation | `resting` | Leave idle until promoted. |
| 4 | `todo` | unassigned | no owner | `resting` | Do not wake; surface as unassigned ready work if appropriate. |
| 5 | `todo` | agent assigned, invokable, not budget-blocked | queued wake, scheduled retry, or deferred issue execution exists | `live` | Preserve the existing path; do not enqueue duplicates. |
| 6 | `todo` | agent assigned, invokable, not budget-blocked | no run yet, no queued wake, no pause hold | `dispatchable` | Assignment dispatch may enqueue one backstop wake. |
| 7 | `todo` | agent assigned | pending interaction, linked approval, active pause hold, or open review/recovery/productivity issue owns next action | `waiting` | `todo` can wait explicitly, but the wait owner/action must be first-class. |
| 8 | `todo` | agent assigned, invokable, not budget-blocked | latest failed/timed-out/cancelled issue run and no live path | `recoverable_by_control_plane` | Queue one dispatch recovery wake, then escalate if exhausted. |
| 9 | `todo` or `in_progress` | agent assigned but paused, terminated, pending approval, uninvokable, or budget hard-stopped | no valid wait/recovery artifact already owns the next action | `human_escalation_required` | Board/manager must resume, reconfigure, raise budget, reassign, or cancel. |
| 10 | `todo`, `in_progress`, `in_review`, or `blocked` | agent assigned | active subtree pause/cancel hold covers the issue | `waiting` with `pause_hold` | Suppress dispatch, recovery, scheduled retry promotion, and bounded continuation until released. |
| 11 | `in_progress` | agent assigned | active run exists | `live` with `active_run` | Active-run watchdog may review silence; liveness recovery must not replace the live process. |
| 12 | `in_progress` | agent assigned | queued continuation, scheduled retry, or deferred issue execution exists | `live` | Preserve the queued path and dedupe equivalent wakes. |
| 13 | `in_progress` | agent assigned | pending interaction, linked approval, execution participant, active pause hold, or open review/recovery/productivity issue owns next action | `waiting` | Show owner/action; do not call a finished run the wait. |
| 14 | `in_progress` | agent assigned, invokable, not budget-blocked | live path disappeared after failed/timed-out/cancelled run and recovery attempt remains | `recoverable_by_control_plane` | Queue one continuation recovery wake. |
| 15 | `in_progress` | agent assigned, invokable, not budget-blocked | latest successful run made useful progress, issue is non-terminal, runnable next action exists, attempts remain, and no wait/live path exists | `agent_continuable` | Queue bounded `run_liveness_continuation` with idempotency key. |
| 16 | `in_progress` | agent assigned | latest successful run is non-terminal but next action is ambiguous, manager-review, approval-required without interaction, or continuation attempts are exhausted | `human_escalation_required` | Create/reuse explicit recovery or review work; do not silently pass. |
| 17 | `in_review` | human user assigned | user owns the review decision | `waiting` with `human_owner` | Board/user action is the valid wait path. |
| 18 | `in_review` | agent assigned | typed execution-policy participant, pending interaction, linked approval, active/queued issue wake, or explicit recovery issue exists | `waiting` | `in_review` is healthy only because the typed path exists, not because of status alone. |
| 19 | `in_review` | agent assigned | no participant, interaction, approval, user owner, active run, queued wake, or recovery issue | `invalid` | Reject new writes; for stored rows surface `in_review_without_action_path` and convert to recovery/escalation. |
| 20 | `blocked` | any valid owner | first-class blockers exist and every non-terminal unresolved leaf is `live`, `waiting`, `dispatchable`, `recoverable_by_control_plane`, `agent_continuable`, or `human_escalation_required` with an owned artifact/action | `waiting` with `blocker_chain` | Source remains idle; parent surfaces the first unresolved leaf and owner/action. |
| 21 | `blocked` | any valid owner | blocker leaf is `invalid`, cancelled as a blocker, unassigned without an action path, uninvokable without escalation, or recursively stalled recovery work | `invalid` | Surface the first bad leaf; create/reuse one recovery/unblock artifact when safe. |
| 22 | `blocked` | any valid owner | structured external owner/action exists and is still current | `waiting` with external owner/action | Source remains idle; UI must show the external owner and requested action. |
| 23 | `blocked` | any valid owner | no `blockedByIssueIds`, no live wait primitive, and no structured external owner/action | `invalid` | New writes should be rejected; stored rows need explicit unblock/recovery work. |
| 24 | any non-terminal | user assigned | human owns the next move | `waiting` with `human_owner` | Heartbeat liveness recovery does not apply. |
| 25 | any non-terminal | agent assigned | open watchdog or productivity review owns the decision | `waiting` with explicit review artifact | The source is not failed by definition; manager/recovery owner decides. |
| 26 | any non-terminal recovery issue | agent assigned | origin is recovery work and the recovery issue itself failed or lost execution | `human_escalation_required` | Update/block the recovery issue in place; do not create recovery-of-recovery descendants. |

Budget hard stops never imply `done`, and pause holds never imply `terminal`. They are gates on invocation and recovery, not evidence that product work completed.

### Fixture matrix for classifier tests

These fixtures come from recent product incidents and plans. Implementations should encode them as synthetic table rows rather than depending on production data.

| Fixture | Source | State vector to synthesize | Expected disposition | Assertion |
|---|---|---|---|---|
| `invalid-review-leaf-pi-autoresearch` | [PAP-2787](/PAP/issues/PAP-2787) / [PAP-2667](/PAP/issues/PAP-2667) | `in_review`, agent-owned, no `executionState.currentParticipant`, no pending interaction/approval, no user owner, no active run, no queued wake, no recovery issue; parent blockers point at this leaf | `invalid` with reason `in_review_without_action_path` | Blocked parents must surface this leaf, never `covered`, `active_child`, or `active_dependency`. |
| `invalid-review-leaf-object-detection` | [PAP-2335](/PAP/issues/PAP-2335) / [PAP-2279](/PAP/issues/PAP-2279) | UX review deliverable appears complete in comments, but issue remains agent-owned `in_review` with no typed wait path | `invalid` until converted to explicit recovery/escalation | Prose handoff does not count as a durable wait or automatic completion. |
| `healthy-review-participant` | Regression companion for [PAP-2787](/PAP/issues/PAP-2787) | `in_review`, agent-owned or policy-owned, `executionState.currentParticipant` names a valid participant who can decide | `waiting` with `participant` | Typed participant is sufficient wait coverage. |
| `healthy-review-confirmation` | [PAP-2708](/PAP/issues/PAP-2708) | productive successful run requested plan confirmation; source is `in_progress` or `in_review`; pending `request_confirmation` targets latest plan revision and names board/user continuation | `waiting` with `interaction` | Must not show `productive_run_stopped`; accepting/rejecting the confirmation owns continuation. |
| `healthy-linked-approval` | Explicit-wait companion for [PAP-2708](/PAP/issues/PAP-2708) | non-terminal agent-owned issue has a linked pending approval that names the responder/action and remains fresh or tied to a resolvable human owner | `waiting` with `approval` | Pending approvals are durable wait primitives across `todo`, `in_progress`, `in_review`, and `blocked`. |
| `productive-terminal-run-runnable-next-action` | [PAP-2674](/PAP/issues/PAP-2674) / [PAP-2642](/PAP/issues/PAP-2642) | `in_progress`, agent-owned, latest issue-linked run `succeeded`, liveness `advanced`, non-terminal issue, no live/wait path, next action is `runnable`, continuation attempts remain | `agent_continuable` | Finished run progress is not liveness; queue one bounded continuation. |
| `productive-terminal-run-no-next-action` | [PAP-2674](/PAP/issues/PAP-2674) | same as above, but next action is `unknown`, `manager_review`, or attempts are exhausted | `human_escalation_required` | Create/reuse explicit recovery/review work; do not keep spinning. |
| `true-failed-continuation-recovery` | [PAP-2674](/PAP/issues/PAP-2674) | `in_progress`, agent-owned, latest run `failed`, `timed_out`, or `cancelled`, no live/wait path, recovery attempt remains | `recoverable_by_control_plane` with `continuation` | Queue one automatic recovery wake and preserve owner. |
| `explicit-productivity-review-hold` | [PAP-2602](/PAP/issues/PAP-2602) / [PAP-2536](/PAP/issues/PAP-2536) | source issue has high churn/no-comment/long-active evidence and one open `issue_productivity_review` child | `waiting` with explicit review artifact | Source is yellow manager review, not failed; no duplicate review children. |
| `productivity-threshold-without-review` | [PAP-2602](/PAP/issues/PAP-2602) | no-comment streak, high churn, or long active threshold exceeded; no open review exists yet | `human_escalation_required` | Reconciler creates/reuses one manager-facing review; after that artifact exists, the source reclassifies as `waiting`. |
| `healthy-long-active-run` | [PAP-2602](/PAP/issues/PAP-2602) | `in_progress`, agent-owned, active run exists, duration exceeds long-active threshold, no silence-critical decision yet | `live` plus possible watchdog/productivity review side effect | Do not kill or replace the active run just because it is long. |
| `recovery-of-recovery-failure` | [PAP-2486](/PAP/issues/PAP-2486) / [PAP-2479](/PAP/issues/PAP-2479) | issue origin is `stranded_issue_recovery`; its own run fails/losses execution; no live path remains | `human_escalation_required` with owner `recovery_owner` or manager | Update/block the same recovery issue in place; create no nested recovery issue. |
| `normal-source-recovery-dedupe` | [PAP-2486](/PAP/issues/PAP-2486) | non-recovery source work exhausted automatic recovery and has no live/wait path | `human_escalation_required` represented by one open stranded recovery issue | Dedupe by source/fingerprint; concurrent scans cannot create two open recovery artifacts. |
| `blocked-chain-healthy-leaf` | [PAP-2335](/PAP/issues/PAP-2335) companion | parent `blocked`, unresolved leaf has active run, queued wake, pending interaction, human owner, or explicit recovery issue | `waiting` with `blocker_chain` | Parent is covered and should not wake until blockers resolve. |
| `blocked-chain-cancelled-leaf` | Required by [PAP-2790](/PAP/issues/PAP-2790) | parent `blocked`, unresolved blocker leaf is `cancelled` and still listed as blocker | `invalid` | Cancelled blockers do not resolve dependency chains automatically; remove/replace blocker or escalate. |
| `budget-hard-stop` | V1 budget rule | agent-owned `todo` or `in_progress`, agent/company/project hard budget stop prevents invocation, no existing wait artifact | `human_escalation_required` with owner `board` | Raise budget, resume, reassign, or cancel; never mark complete. |
| `pause-held-subtree` | Pause-hold contract | non-terminal issue covered by active subtree pause/cancel hold | `waiting` with `pause_hold` | Suppress recovery, dispatch, scheduled retry promotion, and bounded continuation until hold release. |
| `dual-assignee-write` | Single-assignee invariant | both agent and user assignee set on proposed or stored issue | `invalid` | API rejects with a precise owner invariant error. |

### Agent-assigned `todo`

This is dispatch state: ready to start, not yet actively claimed.

A healthy dispatch state means at least one of these is true:

- the issue already has a queued wake path
- the issue is intentionally resting in `todo` after a completed agent heartbeat, with no interrupted dispatch evidence
- the issue has been explicitly surfaced as stranded through a visible blocked/recovery path

An assigned `todo` issue is stalled when dispatch was interrupted, no wake remains queued or running, and no recovery path has been opened.

If an assigned `todo` issue has no latest issue-linked run, no queued issue wake, no active execution path, no active pause hold, and the assignee is invokable and not budget-blocked, periodic recovery may enqueue one initial assignment dispatch backstop. This is a dispatch backstop, not proof that the issue has already been worked.

### Agent-assigned `in_progress`

This is active-work state.

A healthy active-work state means at least one of these is true:

- there is an active run for the issue
- there is already a queued continuation wake
- there is a scheduled retry or deferred issue-execution wake for the issue
- the issue is covered by an active pause hold
- the issue is waiting on a live pending interaction or linked approval that clearly owns the next action
- there is an open explicit recovery issue for the lost execution path

An agent-owned `in_progress` issue is stalled when it has no active run, no queued continuation, no explicit waiting path, and no explicit recovery surface. A still-running but silent process is not automatically stalled; it is handled by the active-run watchdog contract.

For new handoffs, do not rely on `in_progress` plus a pending interaction as the normal user-facing state. It is accepted as a liveness backstop for compatibility and crash recovery, but the preferred contract is to set the issue to `in_review` before the heartbeat exits.

For terminal successful runs, Paperclip evaluates the canonical issue execution disposition instead of treating success as liveness. A succeeded run with useful output can still leave the issue as `agent_continuable`, `human_escalation_required`, or `invalid` when no separate live or waiting path exists.

Only `terminal`, `resting`, `dispatchable`, `live`, and `waiting` are healthy resting states. `recoverable_by_control_plane`, `agent_continuable`, `human_escalation_required`, and `invalid` must be turned into a bounded continuation, automatic recovery wake, explicit recovery/review/unblock work, rejected write, or visible blocked state.

### `in_review`

This is review/approval state: execution is paused because the next move belongs to a reviewer, approver, board user, or recovery owner.

A healthy `in_review` issue has at least one valid action path:

- a typed execution-policy participant who can approve or request changes
- a live pending issue-thread interaction or linked approval waiting for a named responder
- a human owner via `assigneeUserId`
- an active run or queued wake that is expected to process the review state
- an open explicit recovery issue for an ambiguous review handoff

Agent-assigned `in_review` with no typed participant is only healthy when one of the other paths exists. Assignment to the same agent that produced the handoff is not, by itself, a review path.

An `in_review` issue is stalled when it has no typed participant, no pending interaction or approval, no user owner, no active run, no queued wake, and no explicit recovery issue. Paperclip should surface that state as recovery work rather than silently completing the issue or leaving blocker chains parked indefinitely.

### `blocked`

This is explicit waiting state.

A healthy `blocked` issue has an explicit waiting path:

- first-class blockers exist, and each unresolved leaf has a valid action path under this contract
- the issue is blocked on an explicit recovery issue that itself has a live or waiting path
- the issue is waiting on a live pending interaction, linked approval, human owner, or clearly named external owner/action

A blocker chain is covered only when its unresolved leaf is live or explicitly waiting. An intermediate `blocked` issue does not make the chain healthy by itself.

A `blocked` issue is stalled when the unresolved blocker leaf has no active run, queued wake, typed participant, live pending interaction or approval, user owner, external owner/action, or recovery issue. In that case the parent should show the first stalled leaf instead of presenting the dependency as calmly covered.

## 8. Crash and Restart Recovery

Paperclip now treats crash/restart recovery as a stranded-assigned-work problem, not just a stranded-run problem.

There are two distinct failure modes.

### 8.1 Stranded assigned `todo`

Example:

- issue is assigned to an agent
- status is `todo`
- the original wake/run died during or after dispatch, or dispatch never produced a run
- after restart there is no queued wake and nothing picks the issue back up

Recovery rule:

- if no issue-linked run exists yet, no queued wake exists, no pause hold suppresses recovery, and the assignee is invokable and not budget-blocked, Paperclip queues an initial assignment dispatch wake
- if the latest issue-linked run failed/timed out/cancelled and no live execution path remains, Paperclip queues one automatic assignment recovery wake
- if that recovery wake also finishes and the issue is still stranded, Paperclip moves the issue to `blocked` and posts a visible comment

This is a dispatch recovery, not a continuation recovery.

### 8.2 Stranded assigned `in_progress`

Example:

- issue is assigned to an agent
- status is `in_progress`
- the live run disappeared
- after restart there is no active run and no queued continuation

Recovery rule:

- if the latest run failed/timed out/cancelled and no live execution path remains, Paperclip queues one automatic continuation wake
- if the latest successful run is terminal and the post-run issue disposition is `recoverable_by_control_plane`, Paperclip performs the named bounded repair without choosing product intent
- if the latest successful run is terminal and the post-run issue disposition is `agent_continuable`, Paperclip queues a `run_liveness_continuation` wake with a stable idempotency key and continuation attempt count
- if the latest successful run is terminal and the post-run issue disposition is `human_escalation_required` or `invalid`, Paperclip creates/reuses explicit recovery or review work, rejects/normalizes the invalid transition where possible, or moves the issue to `blocked` with a visible comment
- if the latest successful run is terminal and the post-run issue disposition is `terminal`, `resting`, `dispatchable`, `live`, or `waiting`, Paperclip preserves that disposition and does not treat run success itself as a live path

This is an active-work continuity recovery.

### 8.3 Run liveness classification and bounded continuation

Run liveness classification describes what the just-finished run did. It is not the same thing as issue liveness.

The current classifier records:

- `completed` when the issue is terminal
- `advanced` when the run produced concrete action evidence such as comments, document revisions, work products, activity events, or tool/action events
- `blocked` when the issue or run output declares a concrete blocker
- `needs_followup` when output indicates review, ambiguous follow-up, or useful output without concrete action evidence
- `plan_only` when the run described runnable future work without concrete action evidence
- `empty_response` when the run succeeded without useful output or concrete action evidence
- `failed` when the run itself did not succeed

The classifier also extracts a `nextAction` and actionability signal: `runnable`, `manager_review`, `blocked_external`, `approval_required`, or `unknown`.

Bounded liveness continuation may be queued for:

- `plan_only`
- `empty_response`
- `advanced` only when there is an explicit runnable `nextAction`

Bounded continuation is not queued when:

- the issue is terminal, `blocked`, `in_review`, or otherwise not in `todo`/`in_progress`
- the issue is no longer assigned to the source run agent
- execution-policy state owns the next decision
- a live pending issue-thread interaction or linked approval owns the next decision
- the assignee is not invokable
- a budget hard stop applies
- an equivalent continuation wake already exists
- the max continuation attempts have been used
- a productivity review or active subtree pause hold suppresses continuation

The default max continuation attempts is 2. Exhaustion records a "Bounded liveness continuation exhausted" comment rather than silently spinning.

## 9. Startup and Periodic Reconciliation

Startup recovery and periodic recovery are different from normal wakeup delivery.

On startup and on the periodic recovery loop, Paperclip now does these things in sequence:

1. reap orphaned `running` runs
2. promote due scheduled retries
3. resume persisted `queued` runs
4. reconcile stranded assigned work
5. reconcile issue-graph liveness
6. scan silent active runs and create or update explicit watchdog review issues
7. reconcile productivity/progression reviews

The stranded-work pass closes the gap where issue state survives a crash but the wake/run path does not. The issue-graph pass covers invalid blocker/review dependency leaves. The silent-run scan covers the separate case where a live process exists but has stopped producing observable output. The productivity-review pass covers unusual but still productive execution patterns that need manager judgment, not automatic failure recovery.

## 10. Silent Active-Run Watchdog

An active run can still be unhealthy even when its process is `running`. Paperclip treats prolonged output silence as a watchdog signal, not as proof that the run is failed.

The recovery service owns this contract:

- classify active-run output silence as `ok`, `suspicious`, `critical`, `snoozed`, or `not_applicable`
- collect bounded evidence from run logs, recent run events, child issues, and blockers
- preserve redaction and truncation before evidence is written to issue descriptions
- create at most one open `stale_active_run_evaluation` issue per run
- honor active snooze decisions before creating more review work
- build the `outputSilence` summary shown by live-run and active-run API responses

Suspicious silence creates a medium-priority review issue for the selected recovery owner. Critical silence raises that review issue to high priority and blocks the source issue on the explicit evaluation task without cancelling the active process.

Watchdog decisions are explicit operator/recovery-owner decisions:

- `snooze` records an operator-chosen future quiet-until time and suppresses scan-created review work during that window
- `continue` records that the current evidence is acceptable, does not cancel or mutate the active run, and sets a 30-minute default re-arm window before the watchdog evaluates the still-silent run again
- `dismissed_false_positive` records why the review was not actionable

Operators should prefer `snooze` for known time-bounded quiet periods. `continue` is only a short acknowledgement of the current evidence; if the run remains silent after the re-arm window, the periodic watchdog scan can create or update review work again.

The board can record watchdog decisions. The assigned owner of the watchdog evaluation issue can also record them. Other agents cannot.

## 11. Productivity and Progression Review

Productivity review is a separate lane from liveness recovery.

Liveness recovery asks: "does this issue have an accountable live/waiting/recovery path?" Productivity review asks: "is this autonomous progression pattern still a good use of time?"

The productivity review reconciler scans agent-owned `todo` and `in_progress` issues. It skips user-owned issues, hidden issues, productivity-review issues, and descendants of productivity-review issues.

It creates or updates at most one open `issue_productivity_review` child issue per source issue when one of these triggers fires:

- no-comment streak: 10 consecutive completed issue-linked runs by the assigned agent without a run-created issue comment
- long active duration: default 6 hours in the current active episode
- high churn: default 10 runs or assignee run-linked comments in 1 hour, or 30 in 6 hours

The review issue includes source issue, assigned agent, trigger reasons, sampled run/comment evidence, cost evidence when available, thresholds, and current next action. It is assigned to the source assignee's manager when possible, then creator, project lead, CTO/CEO-style fallback, subject to same-company and invokable/budget checks. The source issue is not automatically cancelled or reassigned by this review.

Open productivity reviews can hold further automatic liveness continuations for soft-stop triggers:

- no-comment streak
- high churn

Long active duration creates review work but does not interrupt an already active run by itself.

Closing a productivity review as `done` acts as a short snooze for repeat review creation on the same source issue. The default resolved-review snooze is 6 hours.

Productivity review issues must not create productivity-review descendants. They are manager decision points, not new autonomous loops.

## 12. Pause Holds and Recovery Suppression

Subtree pause/cancel/restore holds are execution-control primitives. While an issue is covered by an active pause hold, Paperclip treats the hold as an explicit waiting path and suppresses automatic recovery and liveness continuation for that issue.

This includes:

- assigned `todo` dispatch backstops
- assigned `todo` or `in_progress` recovery wakes
- bounded `run_liveness_continuation` wakes
- scheduled retry promotion
- deferred issue-execution promotion

Pause holds do not make the issue complete. They intentionally stop automatic execution while preserving visible ownership, blockers, comments, and recovery evidence. Explicit human/operator actions can still resolve, reassign, unblock, or restore the held tree through the relevant tree-control flow.

During startup and periodic reconciliation, pause-hold checks run inside the affected passes rather than as a separate top-level phase. The current sequence remains: reap orphaned `running` runs, promote due scheduled retries, resume persisted `queued` runs, reconcile stranded assigned work, reconcile issue-graph liveness, scan silent active runs, then reconcile productivity/progression reviews. Any pass that would otherwise dispatch, promote, continue, or escalate held issue work must recognize the active pause hold first and leave the issue quiet until the hold is released.

User-visible history should retain attribution for these control actions. `issue.tree_hold_created` records who paused or cancelled the tree, and `issue.tree_hold_released` records who resumed or restored it. Raw heartbeat-run cancellation caused by the hold is a process interruption detail; it is not itself the same as pausing issue work.

## 13. Auto-Recover vs Explicit Recovery vs Human Escalation

Paperclip uses three different recovery outcomes, depending on how much it can safely infer.

### Auto-Recover

Auto-recovery is allowed when ownership is clear and the control plane only lost execution continuity.

Examples:

- queue an initial dispatch wake for an assigned `todo` issue with no run and no queued wake
- requeue one dispatch wake for an assigned `todo` issue whose latest run failed, timed out, or was cancelled
- requeue one continuation wake for an assigned `in_progress` issue whose live execution path disappeared
- queue bounded liveness continuation when a terminal successful run left a runnable next action but no live path
- assign an orphan blocker back to its creator when that blocker is already preventing other work

Auto-recovery preserves the existing owner. It does not choose a replacement agent.

### Explicit Recovery Issue

Paperclip creates an explicit recovery issue when the system can identify a problem but cannot safely complete the work itself.

Examples:

- automatic stranded-work retry was already exhausted
- a dependency graph has an invalid/uninvokable owner, unassigned blocker, or invalid review participant
- an active run is silent past the watchdog threshold
- a terminal successful run left a non-terminal issue with no safe runnable action path
- a stranded recovery issue itself failed; recovery issues are blocked in place rather than spawning nested stranded-recovery issues

The source issue remains visible and blocked on the recovery issue when blocking is necessary for correctness. The recovery owner must restore a live path, resolve the source issue manually, or record the reason it is a false positive.

Instance-level issue-graph liveness auto-recovery is disabled by default. When enabled, its lookback window means "dependency paths updated within the last N hours"; older findings remain advisory and are counted as outside the configured lookback instead of creating recovery issues automatically. This is an operator noise control, not the older staleness delay for determining whether a chain is old enough to surface.

### Human Escalation

Human escalation is required when the next safe action depends on board judgment, budget/approval policy, or information unavailable to the control plane.

Examples:

- all candidate recovery owners are paused, terminated, pending approval, or budget-blocked
- the issue is human-owned rather than agent-owned
- the run is intentionally quiet but needs an operator decision before cancellation or continuation

In these cases Paperclip should leave a visible issue/comment trail instead of silently retrying.

## 14. What This Does Not Mean

These semantics do not change V1 into an auto-reassignment system.

Paperclip still does not:

- automatically reassign work to a different agent
- infer dependency semantics from `parentId` alone
- treat human-held work as heartbeat-managed execution
- treat productivity review as proof of failure or as permission to cancel active work automatically

The recovery model is intentionally conservative:

- preserve ownership
- retry once when the control plane lost execution continuity
- continue productive work only through bounded, idempotent continuation paths
- create explicit recovery work when the system can identify a bounded recovery owner/action
- create productivity review work when the work is progressing but unusual enough to need manager judgment
- escalate visibly when the system cannot safely keep going

## 15. Practical Interpretation

For a board operator, the intended meaning is:

- agent-owned `in_progress` should mean \"this is live work or clearly surfaced as a problem\"
- agent-owned `todo` should not stay assigned forever after a crash with no remaining wake path
- productive work can continue, but unusual no-comment or high-churn patterns become manager-visible productivity reviews
- pause-held trees are intentionally quiet until restored or manually acted on
- parent/sub-issue explains structure
- blockers explain waiting

That is the execution contract Paperclip should present to operators.
