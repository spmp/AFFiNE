# PR stack: conventions and procedure

This fork carries its work as a **linear stack of PR branches** on top of
`upstream/canary`. Each branch is based on the one before it, and each holds
one feature or theme, so it can be reviewed and released upstream on its own.
`pr/00` (this branch: the stack's scripts and docs, plus one upstream-candidate
settings fix) sits near the top, so the feature PRs don't carry fork tooling.
`pr/N-build` sits above it and adds only what is needed to build and deploy
the fork.

The chain lives in `.git/machete` and is rebased with
`scripts/cascade-rebase.sh` (this branch). The script isn't in the feature
branches, so run it from a copy outside the checkout:
`git show pr/N-build:scripts/cascade-rebase.sh > ~/bin/cascade-rebase.sh`. The per-PR roadmap is in
[ROADMAP.md](./ROADMAP.md).

## Branch numbering

| Range           | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `pr/00`         | Fork tooling and tidy-ups (this stack's scripts and docs); sits below N   |
| `pr/02`–`pr/2x` | Features (editor, edgeless, blocks, databases, Journal Todo)               |
| `pr/30`–`pr/3x` | Mobile and PWA client work                                                 |
| `pr/40`–`pr/4x` | Server-side changes (including the PWA build/serving in `pr/41`)           |
| `pr/50`–`pr/5x` | Standalone, high-level fixes (engine/component level, upstream candidates) |
| `pr/N-build`    | Build and deploy only: Docker, rebuild scripts, debug tooling              |

## Rules

- **One feature or change per branch.** A fix to a feature goes into the
  branch that introduced that feature (e.g. Journal Todo fixes go into
  `pr/19`, mobile included). Open a new branch only when the work is
  genuinely outside every existing branch's scope.
- **`pr/N-build` carries no product changes.** Day-to-day work may land on
  `pr/N-build` first, but must be moved to its owning branch before release.
- **Order follows dependencies.** A branch may only depend on branches below
  it in the chain.
- **Tests run on `pr/N-build`**, which contains everything.
- **Backups before any history rewrite**, under
  `backup/<YYYY-MM-DD>/<stage>/<branch>`.

## Layout

Agreed 2026-10-28; `pr/00` moved from the bottom to just below `pr/N-build`
on 2026-11-10 (backups `backup/2026-11-10/pre-restack/*`). The
`cascade-rebase.sh` change that had been committed into `pr/05` moved into
`pr/00` at the same time.

```
canary
  pr/02 ... pr/17                       (edgeless canvas and export)
    pr/18-reusable-blocks
      pr/19-todo-database-integration-in-journal
        pr/30-mobile-keyboard-toolbar
          pr/31-mobile-settings
            pr/40-server-compression
              pr/41-server-pwa
                pr/42-mobile-debug-tools
                  pr/50-store-parent-index
                    pr/51-toast-container
                      pr/00-tidy-up-canary-and-tools
                        pr/N-build
```

`cascade-rebase.sh` runs a plain `git rebase <parent>`, so it keeps this
order up to date but can't change it. To move a branch, replay each
branch's own commits onto its new parent:
`git replay --onto <new parent> <old parent>..<branch>` (without
`--contained`, which would also move backup branches).

What moves where is listed per branch in [ROADMAP.md](./ROADMAP.md).
Commits that must be split while moving: `5c7a77b75f`, `bc74d3e60a`,
`6c8b514fc5`, `da4195d23a`, `bdf857cd3d`, and the three `contenteditable`
boundary commits (`c7d3e62e40`, `2c2af31ec0`, `a6479356ec`, squashed into one
commit with the end result). The `MobileDebugLog` calls added to the keyboard
toolbar (`dc2ed070b3`) go to `pr/42` with the rest of the debug tooling,
which sits above `pr/30` in the stack.

## Procedure

Status is tracked in the checklist at the end.

### 1. Baseline check

Confirm the current `pr/N-build` works before changing any history:
rebuild the dev server, then check desktop and the mobile PWA (see
[Device checks](#device-checks)). Note any known failures so they aren't
mistaken for regressions later.

### 2. Backup, then reorganise

```sh
d=$(date +%F)
for b in $(git branch --format='%(refname:short)' | grep '^pr/'); do
  git branch -f "backup/$d/pre-rearrange/$b" "$b"
done
```

Build the new layout on fresh branches by cherry-picking from `pr/N-build`
in stack order, splitting the commits listed above. Then:

- **Tree check:** the rebuilt `pr/N-build` must have exactly the same files
  as the backup:
  `git diff --stat backup/$d/pre-rearrange/pr/N-build pr/N-build` is empty.
- **Per-branch check:** each branch builds and its own tests pass on its own
  (catches a commit placed below something it depends on).
- Update `.git/machete` to the new chain.
- Run the full test set on `pr/N-build` (see [Tests](#tests)), rebuild the
  dev server, and do the device checks.

Nothing is force-pushed until this has been reviewed.

### 3. Backup the reorganised stack

```sh
for b in $(git branch --format='%(refname:short)' | grep '^pr/'); do
  git branch -f "backup/$d/pre-rebase/$b" "$b"
done
```

### 4. Rebase onto the latest upstream canary

```sh
git fetch upstream canary
git branch -f canary upstream/canary
cascade-rebase.sh plan
cascade-rebase.sh run --verify-cmd "git status --short"
```

`cascade-rebase.sh` auto-resolves only conflicts where one side is identical
to the already-rebased parent; anything else halts for manual resolution
(resolve, `git add`, re-run `run`). Then the full test set on `pr/N-build`,
rebuild, and device checks again.

### 5. Document and release

Update [ROADMAP.md](./ROADMAP.md) (what each branch contains, its status,
known issues), then open the upstream PRs bottom-up. Fork-only material
(`pr/00`'s stack docs and scripts, `pr/N-build`) is not part of any upstream
PR.

## Tests

Run on `pr/N-build`:

| Suite                  | Command                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| Lint                   | `yarn lint:ox`                                                                 |
| Type check             | `NODE_OPTIONS=--max-old-space-size=14384 yarn typecheck`                       |
| Unit tests             | `yarn vitest run`                                                              |
| BlockSuite integration | `cd blocksuite/integration-test && npx vitest run` (chromium, firefox, webkit) |
| Mobile integration     | `... --config vitest.mobile.config.ts` and `vitest.mobile.webkit.config.ts`    |
| E2E                    | `tests/affine-local` (Playwright, incl. its webkit/firefox configs)            |
| Server                 | `packages/backend/server` AVA suite                                            |

Known failures on `pr/N-build` (2026-10-29, after the reorganisation; the
code is identical to before it, so none of these come from moving commits):

- **Unit (`yarn vitest run --project '!@blocksuite/integration-test'`):**
  20 failures in 13 files: `blocksuite/framework/store` (block model "with
  stash and pop", "deep sync", and related); database "promotes ancestors
  from descendant done and cascades todo without overwriting manual done
  descendants"; `@affine/electron` recording feature (4) and workspace db
  handlers (6); drawio shape-library category ordering; nbstore
  auto-reconnection (timing); admin dashboard chart colours; BYOK settings.
- **BlockSuite integration (Chromium, `mobile/` excluded):** `last-props.spec.ts`
  "shapes" (colour `#3cbc36` vs `#fcd34d`, consistent); one real-browser
  `note-ref.spec.ts` test (a different one each run: timing).
- **Mobile integration (Chromium):** `keyboard-enter-focus-loss.spec.ts`
  "pressing Enter on an empty root-level row…" asserts the synchronous
  refocus of `5fc3a29139`, which `b0af252deb` replaced with reactive
  focusout reclaim (confirmed on device); the test is stale. Not caused by
  today's performance commits (checked by reverting each).
- Run the desktop integration config with `--exclude 'src/__tests__/mobile/**'`:
  the `mobile/` specs belong to `vitest.mobile.config.ts` and fail spuriously
  under the desktop config.
- Some mobile test names are too long for their failure screenshots
  (`ENAMETOOLONG`).

Firefox/WebKit integration, the mobile WebKit config, `tests/affine-local` E2E
and the server suite have not been run in this environment (browsers not
installed).

## Device checks

After each rebuild of the dev server:

- **Desktop:** typing and Enter in a long page; a Journal Todo (typing,
  ticking, dragging, "Journal Todo" and "New Journal Todo Table"); a new
  journal from the template uses the current Journal Todo table; paste into
  a same-page linked note.
- **Mobile PWA:** accept the update banner, then the same Journal Todo flows
  through the keyboard toolbar; tapping into linked-note text; full close,
  airplane mode, relaunch from the home-screen icon.

## Status

- [ ] 1. Baseline check of the current build (desktop + PWA)
- [ ] 2. Backup `pre-rearrange`, reorganise, tests, rebuild, device checks
  - [x] 2026-10-28 backups `backup/2026-10-28/pre-rearrange/*` (+ `.git/machete` copy)
  - [x] 2026-10-28 reorganised; rebuilt `pr/N-build` has identical files to
        the backup except the 3 dropped `.planning` summaries; `.git/machete`
        updated
  - [x] 2026-10-29 tests on `pr/N-build`: lint and type check pass; unit,
        integration and mobile failures are all known (see Tests)
  - [ ] rebuild and device checks
- [ ] 3. Backup `pre-rebase`
- [ ] 4. Rebase onto upstream canary, tests, rebuild, device checks
- [ ] 5. Update the roadmap, release PRs upstream
