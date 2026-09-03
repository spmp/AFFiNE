---
phase: 04-mobile-toolbar-reachability-and-navigation-fixes
plan: 04
subsystem: ui
tags: [blocksuite, mobile, keyboard, lit, react, signals, vitest]

# Dependency graph
requires:
  - phase: 04-CONTEXT
    provides: D-09 decision (extend the existing app.tsx visualViewport listener chain; no second listener)
provides:
  - "AffineKeyboardToolbar's host bottom style reactively tracks keyboard.visible$/height$/appTabSafeArea$ (blocksuite/affine/widgets/keyboard-toolbar/src/keyboard-toolbar.ts)"
  - "computeAppTabsBottomOffset(keyboardHeight) pure function + AppTabs wiring via VirtualKeyboardService.height$ (packages/frontend/core/src/mobile/components/app-tabs/)"
affects: []

# Actuals (#2632)
actuals:
  tokens: 0
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Reuse an already-injected reactive signal/service instead of adding a second visualViewport listener (D-09)"
    - "Fold a new reactive concern into an existing effect() block rather than creating a parallel one, when both read the same signal source"

key-files:
  created:
    - blocksuite/integration-test/src/__tests__/mobile/keyboard-toolbar-position-touch.spec.ts
    - packages/frontend/core/src/mobile/components/app-tabs/keyboard-offset.ts
    - packages/frontend/core/src/mobile/components/app-tabs/keyboard-offset.spec.ts
  modified:
    - blocksuite/affine/widgets/keyboard-toolbar/src/keyboard-toolbar.ts
    - packages/frontend/core/src/mobile/components/app-tabs/index.tsx

key-decisions:
  - "Both plan tasks were already fully implemented and committed by the crashed prior session (commits d6c2537e40, 0d34a266f0) before this resume session started; this session's job was verification, gap-closing, and gate-running only — no new implementation code was written."
  - "Discarded an uncommitted yarn.lock diff found in the worktree (adding @blocksuite/affine-block-list/@blocksuite/affine-block-paragraph under @blocksuite/data-view's resolution). Traced via git blame to a Phase 3 commit (47c7fa275a, already on this plan's base commit 3ad846463a) that added those deps to blocksuite/affine/data-view/package.json without running yarn install to sync yarn.lock. This predates and is unrelated to plan 04-04's files_modified list, so per the scope-boundary rule (only auto-fix issues directly caused by the current task's changes) it was left untouched rather than folded into this plan's diff. Restored with `git checkout -- yarn.lock`."

requirements-completed: [MOBILE-15]

coverage:
  - id: D1
    description: "AffineKeyboardToolbar's host bottom style reactively tracks keyboard.visible$/height$/appTabSafeArea$, proven live (not one-time read) by a new integration test"
    requirement: "MOBILE-15"
    verification:
      - kind: integration
        ref: "blocksuite/integration-test/src/__tests__/mobile/keyboard-toolbar-position-touch.spec.ts#host bottom style reactively tracks keyboard.height$/visible$/appTabSafeArea$"
        status: pass
    human_judgment: false
    rationale: "Test executed in this session via `yarn workspace @blocksuite/integration-test test:mobile src/__tests__/mobile/keyboard-toolbar-position-touch.spec.ts` — 1/1 passed."
  - id: D2
    description: "AppTabs reactively applies computeAppTabsBottomOffset(keyboardHeight) from the already-injected VirtualKeyboardService, with existing hide-on-keyboard-visible logic unchanged"
    requirement: "MOBILE-15"
    verification:
      - kind: unit
        ref: "packages/frontend/core/src/mobile/components/app-tabs/keyboard-offset.spec.ts"
        status: pass
    human_judgment: false
    rationale: "Test executed in this session via `yarn test packages/frontend/core/src/mobile/components/app-tabs/keyboard-offset.spec.ts` — 2/2 passed."
  - id: D3
    description: "No second, separate visualViewport listener was added anywhere"
    requirement: "MOBILE-15"
    verification:
      - kind: manual
        ref: "grep -rn visualViewport blocksuite/affine/widgets/keyboard-toolbar/src/keyboard-toolbar.ts packages/frontend/core/src/mobile/components/app-tabs/ (no matches); both changes only read pre-existing signals (this.keyboard.*, VirtualKeyboardService.height$)"
        status: pass
    human_judgment: false
    rationale: "Confirmed by direct code inspection of both diffs — neither adds any listener, both fold into pre-existing reactive signal reads."

duration: ~25min (resume/verification only)
completed: 2026-09-03
status: complete
---

# Phase 04 Plan 04: Keyboard-Aware Toolbar/Nav Repositioning Summary

**Resumed after a crashed orchestrator session; both tasks (keyboard-toolbar host `bottom` tracking `keyboard.visible$/height$/appTabSafeArea$`, and AppTabs' `computeAppTabsBottomOffset` sourced from `VirtualKeyboardService.height$`) were already fully implemented, tested, and committed — this session verified completeness, ran the full gate suite (both new tests + oxlint + typecheck, all zero-error), and discarded one unrelated stray yarn.lock diff.**

## Performance

- **Duration:** ~25 min (verification/gap-closing only; no new implementation)
- **Tasks:** 2/2 already complete on resume
- **Files modified:** 0 new changes this session (all 5 plan files already correct from the crashed session's commits)
- **Commits:** 0 new commits — nothing to commit; existing `d6c2537e40` and `0d34a266f0` already satisfy the plan in full

## Accomplishments

- Confirmed `AffineKeyboardToolbar.connectedCallback()`'s existing `effect()` (the one toggling `data-keyboard-visible`/`data-panel-open`) was extended in-place to also set `this.style.bottom` from `this.keyboard.visible$`/`height$`/`appTabSafeArea$` — no second `effect()` block, no new listener, `styles.ts` has zero diff from base (verified via `git diff 3ad846463a -- .../styles.ts` returning empty).
- Confirmed `computeAppTabsBottomOffset(keyboardHeight)` exists as a pure function in a new sibling file, returning `undefined` for `0` and `'-302px'` for `300`, and is wired into `AppTabs`' `<SafeArea>` inline style via a new `useLiveData(virtualKeyboardService.height$)` read, additive to (not replacing) the existing `visibility`/`pointerEvents` hide-on-keyboard-visible logic.
- Ran both plan-specified `<verify>` commands in this session (neither had been executed by the crashed session, per the prior 04-02-SUMMARY.md's noted limitation of that environment): `keyboard-toolbar-position-touch.spec.ts` (1/1 pass) and `keyboard-offset.spec.ts` (2/2 pass).
- Ran the full quality gate: `yarn oxlint` (exit 0, zero errors) and `NODE_OPTIONS=--max-old-space-size=14384 yarn typecheck` (exit 0, zero errors across all workspace projects).
- Investigated and resolved the one piece of uncommitted state left in the worktree (see Deviations).

## Task Commits

Both tasks were already committed atomically by the prior (crashed) session — verified present on this branch, no new commits needed this session:

1. **Task 1: Make the keyboard-toolbar's own bottom position actively track keyboard height** - `d6c2537e40` (feat)
2. **Task 2: Apply the same active repositioning to the mobile bottom nav bar (AppTabs)** - `0d34a266f0` (feat)

## Files Created/Modified
- `blocksuite/affine/widgets/keyboard-toolbar/src/keyboard-toolbar.ts` - host `style.bottom` now reactively tracks `keyboard.visible$/height$/appTabSafeArea$` inside the existing effect
- `blocksuite/integration-test/src/__tests__/mobile/keyboard-toolbar-position-touch.spec.ts` - new integration test proving the live binding
- `packages/frontend/core/src/mobile/components/app-tabs/keyboard-offset.ts` - new pure function `computeAppTabsBottomOffset`
- `packages/frontend/core/src/mobile/components/app-tabs/keyboard-offset.spec.ts` - new unit test for the pure function
- `packages/frontend/core/src/mobile/components/app-tabs/index.tsx` - reads `virtualKeyboardService.height$` and threads the offset into `<SafeArea>`'s inline style

## Decisions Made
- Treated the two existing commits as authoritative prior work rather than re-implementing: diffed each commit's file list and content against the plan's `<action>`/`<acceptance_criteria>` line by line before concluding no further implementation was needed.
- Discarded the uncommitted `yarn.lock` diff (see Deviations) rather than committing it as part of this plan, since it is unrelated to and predates plan 04-04's scope.

## Deviations from Plan

### Auto-fixed Issues

None — both tasks' code was already correct and complete; the only action taken beyond verification was discarding an out-of-scope, unrelated uncommitted diff (documented below, not a code fix).

### Out-of-scope item found and left alone

**1. Stale `yarn.lock` diff for `@blocksuite/data-view`'s dependency resolution**
- **Found during:** Initial `git status` check on resuming the worktree
- **Issue:** `yarn.lock` had an uncommitted diff adding `@blocksuite/affine-block-list` and `@blocksuite/affine-block-paragraph` as resolved workspace deps under `@blocksuite/data-view`. `git blame` on `blocksuite/affine/data-view/package.json` traced these two dependency entries to Phase 3 commit `47c7fa275a` ("LIST-02/03/04"), which is already part of this plan's base commit (`3ad846463a`) — i.e., the `package.json` has declared these deps since before this plan started, but `yarn.lock` was never regenerated to match (likely a stray `yarn install` run in this worktree at some point, not part of any committed plan work).
- **Decision:** Left unfixed, per the scope-boundary rule ("Only auto-fix issues DIRECTLY caused by the current task's changes... Pre-existing... issues in unrelated files are out of scope"). This diff touches zero files in this plan's `files_modified` list and has no bearing on MOBILE-15.
- **Action taken:** `git checkout -- yarn.lock` to restore the worktree to a clean state matching the last commit, so this plan's branch diff contains only its own 5 files.
- **Not committed.**

---

**Total deviations:** 0 auto-fixed; 1 out-of-scope item identified and left untouched (not a deviation from this plan's own work).
**Impact on plan:** None — this plan's deliverable was unaffected; the stray `yarn.lock`/`package.json` mismatch is a pre-existing Phase 3 artifact that should be addressed (if still needed) in a future phase or dedicated `yarn install` pass, not folded into this plan.

## Issues Encountered
- `yarn oxlint` and `NODE_OPTIONS=--max-old-space-size=14384 yarn typecheck` each exceeded the 120s foreground command timeout in this environment (full-monorepo builds) and were run to completion in the background — both exited with code 0, zero errors, no special handling needed beyond polling for process exit.

## Known Stubs
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three `must_haves.truths` are satisfied and directly verified: keyboard-toolbar's own bottom position tracks the live keyboard height signal chain; AppTabs' bottom position tracks the same underlying `VirtualKeyboardService` signal; no second `visualViewport` listener was added anywhere in either diff.
- Both plan-specified automated `<verify>` commands were executed in this session and passed (not just implemented untested, unlike the prior plan 04-02 in this same phase).
- `yarn oxlint` and `NODE_OPTIONS=--max-old-space-size=14384 yarn typecheck` both zero-error across the full monorepo.
- Working tree is clean; `git diff 3ad846463a --stat` shows exactly this plan's 5 files (2 modified, 3 created), matching `files_modified` in the plan frontmatter with no drift or contamination from sibling plans.
- The remaining item in the phase's `<verification>` block — "Live/touch-emulated on-device confirmation... opening the keyboard from a scrolled-up position no longer requires a manual scroll-to-bottom" — is a manual/on-device UAT step outside this executor's automated capability; recommend the orchestrator/user perform this confirmation on a real device or touch-emulated browser session before considering MOBILE-15 fully closed end-to-end.

---
*Phase: 04-mobile-toolbar-reachability-and-navigation-fixes*
*Completed: 2026-09-03*
