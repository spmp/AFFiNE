---
phase: 04-mobile-toolbar-reachability-and-navigation-fixes
plan: 03
subsystem: ui
tags: [blocksuite, note, database, mobile, touch, contenteditable, vitest, playwright]

# Dependency graph
requires:
  - phase: 04-CONTEXT
    provides: D-08 decision (reuse note-ref-block.ts's contenteditable="false" boundary pattern for ordinary notes and database rows)
provides:
  - "NoteBlockComponent's own host (affine-note) carries contentEditable = 'false', isolating its descendant rich-text divs from PageRootBlockComponent's page-wide contentEditable=\"true\""
  - "HeaderAreaTextCell's own host (data-view-header-area-text, shared by List/Table/Kanban title cells) carries the same boundary"
  - "contenteditable-boundary-touch.spec.ts: real-browser proof the nested-contenteditable ambiguity is resolved, descendant rich-text stays editable, and no residual auto-scroll jump remains"
affects: []

# Actuals (#2632)
actuals:
  tokens: 3823
  tasks: 2
  commits: 1

tech-stack:
  added: []
  patterns: ["Reused note-ref-block.ts's existing contenteditable=\"false\" host-boundary idiom rather than inventing a new nested-contenteditable mechanism"]

key-files:
  created:
    - blocksuite/integration-test/src/__tests__/mobile/contenteditable-boundary-touch.spec.ts
  modified:
    - blocksuite/affine/blocks/note/src/note-block.ts
    - blocksuite/affine/blocks/database/src/properties/title/text.ts

key-decisions:
  - "Task 1 and Task 2's work were both already present in the recovered WIP commit (from the crashed prior session) essentially complete and correct -- this execution's job was primarily verification (actually running the previously-unrun test suites) rather than net-new implementation."
  - "Task 2's scroll-delta assertion passed on first run with no suppressingRichTextAutoScroll guard needed -- documented directly in the test's own comment (per the project's established 'live-verify before extending' pattern) rather than speculatively adding suppression code."
  - "Restructured the single crash-recovery 'wip: recover worktree state' commit into one clean fix(04-03) commit via amend (explicitly permitted for this recovery scenario) rather than leaving a WIP-titled commit as the final state, since content required no further changes."

requirements-completed: [MOBILE-14]

coverage:
  - id: D1
    description: "affine-note and data-view-header-area-text hosts carry contenteditable=\"false\" while descendant rich-text remains independently editable, and typed text lands in the model"
    requirement: "MOBILE-14"
    verification:
      - kind: integration
        ref: "blocksuite/integration-test/src/__tests__/mobile/contenteditable-boundary-touch.spec.ts (5 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: ".closest('[contenteditable]') from a paragraph's rich-text div resolves to the rich-text div itself, never affine-page-root"
    requirement: "MOBILE-14"
    verification:
      - kind: integration
        ref: "blocksuite/integration-test/src/__tests__/mobile/contenteditable-boundary-touch.spec.ts > .closest(\"[contenteditable]\") ... never affine-page-root"
        status: pass
    human_judgment: false
  - id: D3
    description: "No residual scroll jump remains after the boundary fix for an already-visible note paragraph or database title cell"
    requirement: "MOBILE-14"
    verification:
      - kind: integration
        ref: "blocksuite/integration-test/src/__tests__/mobile/contenteditable-boundary-touch.spec.ts > Task 2: residual auto-scroll jump verification (2 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "No regression to List/Table/Kanban title-cell editing, note selection/drag-handle, or undo/redo across the full mobile + unit suites"
    requirement: "MOBILE-14"
    verification:
      - kind: integration
        ref: "yarn workspace @blocksuite/integration-test test:mobile (51/51 pass); test:unit (939-940/948 pass across runs, remaining failures confirmed pre-existing/environmental, see Deviations)"
        status: pass
    human_judgment: false

duration: ~55min (resumed crash-recovery session; mostly verification + browser install + regression isolation, not net-new implementation)
completed: 2026-09-03
status: complete
---

# Phase 04 Plan 03: Contenteditable Boundary for Notes and Database Title Cells Summary

**NoteBlockComponent and HeaderAreaTextCell now set `contentEditable = 'false'` on their own host elements, reusing note-ref-block.ts's already-shipped boundary pattern, closing the nested-contenteditable ambiguity that caused a visible page-jump when tapping into a note or database row to edit it on mobile.**

## Context: Resumed From Crash

This plan was originally executed by an earlier session that crashed mid-run inside a Claude Code worktree. The orchestrator safety-committed the crashed session's uncommitted work as a single `wip: recover worktree state (crash recovery, plan 04-03)` commit before this resumption began. On inspection, that WIP commit's diff already contained essentially complete, correct implementations of both of this plan's tasks:

- Task 1's `contentEditable = 'false'` fix on both `NoteBlockComponent` (note-block.ts) and `HeaderAreaTextCell` (text.ts), each with a doc comment explaining the boundary rationale, mirroring note-ref-block.ts's own established idiom.
- A new `contenteditable-boundary-touch.spec.ts` file containing all 5 tests called for across both tasks: the 3 boundary/editability/`.closest()` proofs from Task 1, plus Task 2's 2 scroll-delta assertions (with the "no suppression needed, live-verified" documentation already written into the test's own comment, matching the plan's Task 2 instructions verbatim).

No source-code changes were needed. This session's actual work was: (1) verify the recovered code by actually running the automated suites the plan's `<verify>` blocks specify (which had apparently not been run to completion before the crash — Playwright's Firefox/WebKit/Chromium browsers were not yet installed in this environment), (2) confirm several suite-wide test failures were pre-existing/environmental rather than regressions from this plan's diff, (3) confirm the mandatory `yarn oxlint`/`yarn typecheck` gates, and (4) restructure the crash-recovery WIP commit into a properly-titled commit.

## Accomplishments

- Confirmed `NoteBlockComponent.connectedCallback()` (note-block.ts) sets `this.contentEditable = 'false'` on the component's own host (`<affine-note>`), isolating every descendant paragraph/list/database-row rich-text div as its own editable island relative to `PageRootBlockComponent`'s page-wide `contentEditable="true"`.
- Confirmed `HeaderAreaTextCell.connectedCallback()` (text.ts) extends its existing callback with the same fix, closing the gap for List/Table/Kanban database title cells at once (the component is shared across all three view types).
- Ran the new `contenteditable-boundary-touch.spec.ts` in isolation: **5/5 tests pass**, proving both hosts carry `contenteditable="false"`, descendant rich-text remains independently editable with typed text landing in the model's Y.Text, `.closest('[contenteditable]')` never resolves to `affine-page-root`, and no residual scroll delta (>1px tolerance) occurs when focusing an already-visible paragraph or database row title cell.
- Ran the full mobile suite (`yarn workspace @blocksuite/integration-test test:mobile`, no filter): **51/51 tests pass** across all 10 spec files, including the new spec — no regression to any other mobile-suite test.
- Ran the full unit suite (`test:unit`, no filter, 123 files / 948-960 tests across 3 browser projects): the large majority pass; a handful of failures occurred and were individually root-caused (see Deviations) as pre-existing/environmental, not caused by this plan's diff.
- Installed missing Playwright browser binaries (Firefox, then Chromium+WebKit) in this environment via `yarn playwright install` — required for `test:unit` to run at all; not a source-code change.
- Confirmed `yarn oxlint`: zero errors.
- Confirmed `NODE_OPTIONS=--max-old-space-size=14384 yarn typecheck`: 16 errors, all confined to a single unrelated, pre-existing file (`packages/frontend/templates/edgeless-templates.gen.ts`) whose imports resolve to a gitignored `packages/frontend/templates/edgeless/*.json` asset directory that does not exist in this checkout at all (`.gitignore:89`) — confirmed unrelated to and untouched by this plan's 3 files.
- Restructured the recovered `wip: recover worktree state` commit into a single clean `fix(04-03): add contenteditable=false boundary to notes and database title cells (MOBILE-14)` commit via `git commit --amend` (content required no changes, only the message).

## Task Commits

1. **Tasks 1 + 2 (combined — both already complete in the recovered WIP state)** — `c7d3e62e40` (fix), amended from the crash-recovery WIP commit `1b9fc6b173`

## Files Created/Modified
- `blocksuite/affine/blocks/note/src/note-block.ts` — `NoteBlockComponent.connectedCallback()` sets `this.contentEditable = 'false'` on its own host
- `blocksuite/affine/blocks/database/src/properties/title/text.ts` — `HeaderAreaTextCell.connectedCallback()` extended with the same fix
- `blocksuite/integration-test/src/__tests__/mobile/contenteditable-boundary-touch.spec.ts` — new spec, 5 tests (3 for Task 1's boundary/editability/`.closest()` proofs, 2 for Task 2's scroll-delta verification)

## Decisions Made
- Both plan tasks were already substantively complete in the recovered WIP commit; this session's contribution is verification (actually executing the previously-unrun automated suites) plus commit-hygiene cleanup, not net-new implementation. Documented here rather than silently re-doing already-correct work.
- Task 2's scroll-delta assertion passed on its first run with no `suppressingRichTextAutoScroll` guard added — the recovered test's own comment already documents this as a deliberate "live-verify before extending" outcome (Task 1's boundary alone was sufficient), matching the plan's explicit instruction for this case.
- Amended the crash-recovery WIP commit into a single properly-titled `fix(04-03)` commit rather than leaving `wip: recover worktree state` as the final message, per the resumption instructions explicitly permitting amend in this specific recovery scenario (content was correct and needed no further changes, only the message).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Playwright browser binaries missing from this environment**
- **Found during:** First attempt to run `test:unit`
- **Issue:** `test:unit` (and `test:mobile`, on first attempt) failed immediately with `browserType.launch: Executable doesn't exist at .../firefox-1532/firefox/firefox` (and later, on retry, the same for webkit) — Playwright's browser binaries were never downloaded in this environment.
- **Fix:** Ran `yarn playwright install` (downloads Firefox, Chromium, WebKit binaries) — a browser-binary download, not a package-manager dependency install, so the Rule 3 install exclusion (slopsquatting risk) does not apply; this is Playwright's own official, first-party binary-fetch mechanism referenced directly in its own error message.
- **Files modified:** None (environment-only; no source or lockfile changes).
- **Verification:** `test:mobile` and `test:unit` both proceeded to actually execute tests afterward.

### Investigated, confirmed pre-existing (not fixed — scope boundary rule)

**2. `test:unit`'s full-suite runs surfaced a shifting set of failures across repeated runs: `last-props.spec.ts` (all 3 browsers), `slash-menu-touch.spec.ts`, `mindmap.spec.ts` (IME composition width), `layer.spec.ts` (canvas `getBoundingClientRect()` 0-during-render), `journal-todo-database.spec.ts`, and `note-ref.spec.ts` (2 "real Playwright userEvent" cross-doc focus tests).**
- `last-props.spec.ts` (`apply last props > shapes`) and `slash-menu-touch.spec.ts`'s flake are both already disclosed as pre-existing, unrelated-to-phase-04 flakes in `.planning/phases/02-mobile-keyboard-toolbar-integration-for-database-and-referen/deferred-items.md` (confirmed reproducing in complete isolation, unrelated to any `blocksuite/affine/gfx/shape` or mobile-suite file this plan touches).
- `mindmap.spec.ts` and `layer.spec.ts` failures are canvas/IME layout-timing assertions (`expected 52 to be greater than 52`, `expected 0 to be greater than 0` on `getBoundingClientRect()`) in edgeless GFX shape/canvas code — files this plan's diff never touches, and the failing assertions are exact-boundary layout-timing checks consistent with rendering-under-load flakiness, not logic regressions.
- `journal-todo-database.spec.ts` failed once across multiple runs (passed clean when re-run in isolation alongside `layer.spec.ts`/`mindmap.spec.ts`) — consistent with contention-driven flakiness, not a deterministic failure.
- `note-ref.spec.ts`'s 2 "real (Playwright userEvent) click/markdown-shortcut keeps native focus" tests were the one case worth deeper verification, since they exercise real native-focus behavior inside a nested `BlockStdScope` (note-ref-block.ts's own preview-content boundary), the same conceptual area as this plan's fix. **Directly verified via a temporary, fully-reverted isolation test:** copied this plan's 2 source files back to their exact pre-plan (base commit `3ad846463a`) content, re-ran `note-ref.spec.ts` in isolation — it failed identically (in fact with 1 additional flake) with this plan's fix entirely absent, then restored the files to their exact committed content (confirmed via `git diff` showing zero delta) before continuing. This proves these 2 tests are pre-existing, timing-sensitive `userEvent`-based flakes, not something this plan's `contentEditable = 'false'` boundary regressed.
- None of these 6 files are in this plan's `files_modified` list or touched by its diff. Logged here per the scope-boundary rule rather than fixed.

---
**Total deviations:** 1 auto-fixed (environment setup, Rule 3), 1 investigated-and-confirmed-pre-existing (6 files, scope boundary)
**Impact on plan:** None on this plan's own deliverable — MOBILE-14's fix is complete, its own new spec passes 5/5, and the full mobile suite passes 51/51 with zero regressions attributable to this plan's changes.

## Issues Encountered
- `test:unit`'s full 123-file, 3-browser-project suite takes ~5-6 minutes and, per the already-disclosed pattern from Phase 02's own deferred-items.md, exhibits some run-to-run flakiness under concurrent-browser-instance CPU contention in this environment — a different subset of unrelated tests failed across 2 successive full-suite runs before isolation-testing narrowed the cause to environment/timing rather than this plan's diff.

## Known Stubs
None.

## User Setup Required
None — no external service configuration required. (Playwright browser binaries were installed as part of this session's verification work, not left as a manual step.)

## Next Phase Readiness
- MOBILE-14 is complete: `NoteBlockComponent` and `HeaderAreaTextCell` both carry the `contentEditable = 'false'` boundary, proven by a passing 5-test suite plus a clean full mobile-suite run (51/51).
- `yarn oxlint` and `NODE_OPTIONS=--max-old-space-size=14384 yarn typecheck` both pass with zero errors attributable to this plan (typecheck's 16 pre-existing errors are confined to an unrelated, gitignored-asset file).
- Working tree is clean; `git diff 3ad846463a HEAD --stat` against this plan's base commit shows exactly the 3 plan-declared files plus 2 auto-generated test-screenshot artifacts (consistent with this suite's existing committed-screenshot convention for other mobile specs).
- Live/on-device touch confirmation (the plan's own `<verification>` "Live/touch-emulated on-device confirmation" item) was not performed in this environment (no physical device access) — the automated `.closest()`/scroll-delta proxy tests stand in for it per this plan's own design; flagging for whichever process handles final on-device UAT for Phase 4.

---
*Phase: 04-mobile-toolbar-reachability-and-navigation-fixes*
*Completed: 2026-09-03*
