# PR stack roadmap

One entry per branch, in stack order: what it contains, where it stands,
and what is still open. Conventions and the reorganise/rebase procedure are
in [README.md](./README.md).

**Upstream status** is one of: _not opened_, _open (#nnn)_, _merged_,
_fork-only_.

Last updated: 2026-10-28 (reorganisation done, before the canary rebase).

---

## pr/00-tidy-up-canary-and-tools

- **Scope:** fork tooling and tidy-ups: `scripts/cascade-rebase.sh`, these
  stack docs, an editor-setting fallback fix.
- **Upstream:** the editor-setting fix is a candidate; scripts and docs are
  _fork-only_.
- **Open:** split the editor-setting fix out if it goes upstream.

## pr/02 – pr/17 (edgeless and editor features)

Unchanged by the 2026-10-28 reorganisation. Entries to be filled in.

| Branch                                          | Own commits | Upstream   |
| ----------------------------------------------- | ----------- | ---------- |
| pr/02-color-palettes                            | 25          | not opened |
| pr/03-dotted-line-style                         | 6           | not opened |
| pr/05-connector-core                            | 29          | not opened |
| pr/06-connector-hover-initiation                | 5           | not opened |
| pr/07-flips                                     | 3           | not opened |
| pr/08-grid-and-snapping                         | 18          | not opened |
| pr/09-shapes-and-edges                          | 12          | not opened |
| pr/10-library-shapes                            | 5           | not opened |
| pr/11-advanced-shapes                           | 5           | not opened |
| pr/12-properties-menu-for-shapes-and-connectors | 8           | not opened |
| pr/13-frame-resize                              | 7           | not opened |
| pr/14-png-metadata-export-import                | 3           | not opened |
| pr/15-md-html-export-import                     | 4           | not opened |
| pr/16-frame-from-image-insert                   | 3           | not opened |
| pr/17-middle-click-paste                        | 5           | not opened |

## pr/18-reusable-blocks

- **Scope:** reusable blocks: `note-ref` (a note shown in place, same-page
  or cross-page) and `database-ref`, and the nested editors they mount.
- **Upstream:** not opened.
- **Moving in (reorganisation):**
  - nested editor activation: an outer editor no longer steals activation
    from a nested one (`1fce31abea`)
  - linked-note caret on iOS: touch fallback (`311fd42fa9`) and the root
    cause, the referenced note rendering `display: block` (`fd11e7b544`)
  - paste into a same-page linked note lands at the cursor (`232f83d530`)
  - `contenteditable` boundary on the page root / note (from `c7d3e62e40`,
    `2c2af31ec0`, `a6479356ec`, squashed into one commit; the database-title
    parts went to `pr/19`)
- **Open:**
  - `311fd42fa9`'s touch-caret fallback is probably redundant since
    `fd11e7b544`; remove after an on-device check.

## pr/19-todo-database-integration-in-journal

- **Scope:** databases as task lists and the Journal Todo: List view,
  task status/hierarchy columns, `database-view-ref`, Journal Todo
  commands and template support, database note property, mobile parity
  for all of these.
- **Upstream:** not opened.
- **Moving in (reorganisation):**
  - mobile test infrastructure: real-WebKit mobile vitest config, mobile
    harness scope, Playwright webkit/firefox configs for `tests/affine-local`
  - List view behaves like a native list: Backspace/Delete merge, Enter
    split/dedent, row-move guards (GSD phase 3)
  - List view focus, selection and undo: Cmd/Ctrl+Z, Cmd/Ctrl+A, Enter focus
    loss, select-and-delete, cross-doc store resolution
  - Journal Todo fixes: canonical retry on duplicate, cells written in
    place (the 116 MB doc / crash fix), date filter refresh on template
    duplication, unloaded note doc, open-note icon colour, copies from a
    template point at the current table (`e0d41b94d4`)
  - database touch: tappable title checkbox, no keyboard on tick, list drag
    target, mobile filter menu sizing, "+ Add view" button, mobile database
    editing on by default, database-title `contenteditable`
  - performance: list filter reads only its own columns (`ec6455b327`),
    drag writes only changed hierarchy cells (`32391f4a92`)
  - copy undone tasks into a new Journal Todo table (`7dcf35b2ed`), and the
    slash-menu actions it shares with the keyboard toolbar
    (`insertJournalTodoReference`, `createJournalTodoSourceTable`, from
    `da4195d23a` / `bdf857cd3d`)
- **Open (fork backlog 999.x):**
  - 999.18 performance: Journal Todo title cells read the whole-table
    `cells$` (ticking re-renders every row); rows$ keep-previous-array; 1.8 s
    first click into a row; Enter ~320 ms
  - 999.10: chosen date in the mobile filter dialog not verified to filter
  - 999.4: dragging a row out of the list on touch
  - 999.1: ~3 taps to focus a row
  - known failing database unit test (see README, Tests)
  - the database-title parts of the three `contenteditable` boundary commits
    are kept as three separate commits (another commit edits the same file
    between them); squash before upstream release if wanted

## pr/20-spreadsheet

- **Scope:** spreadsheet work. Not part of the chain (stale since 2026-05).
- **Open:** decide whether to revive or drop.

## pr/30-mobile-keyboard-toolbar (new)

- **Scope:** the mobile keyboard toolbar: its database and reference tools,
  and its placement relative to the on-screen keyboard.
- **Upstream:** not opened.
- **Contents (reorganisation):**
  - database/reference tools: Calendar view, Journal Todo, New Journal Todo
    Table (`bdf857cd3d`), New note, Reference, indent/outdent of List-view
    rows, toolbar on `preview-page` scopes (GSD phases 2, 4)
  - placement: live keyboard height, tab bar follows the keyboard,
    viewport pans, latched window height, scroll-to-caret rules, keyboard
    retract/restore (GSD phase 4, 999.1, 999.11)
- **Open:**
  - before upstream release: remove the `console.debug('[MobileDebugLog] ...')`
    lines left in `keyboard-toolbar.ts`, `widget.ts` and the mobile app's
    `virtual-keyboard-provider.ts` (debug-tooling output, harmless, but they
    belong to `pr/42`)
  - 999.16: toolbar placement in the installed PWA after Enter in a Journal
    Todo row (two attempts reverted)
  - 999.17 part B: rare toolbar disappearance on tablets
  - 999.6: Safari address bar between keyboard and toolbar (Safari tab only)

## pr/31-mobile-settings (new)

- **Scope:** mobile settings open the full desktop settings menu
  (`ca5b35fb08`, 999.14).
- **Upstream:** not opened.

## pr/40-server-compression

- **Scope:** server response compression. Unchanged by the reorganisation.
- **Upstream:** not opened.

## pr/41-server-pwa

- **Scope:** the PWA: service worker, manifest and icons, precache
  injection at build time, server serving of mobile/web assets.
- **Upstream:** not opened.
- **Moving in (reorganisation):**
  - offline launch: navigations are routed before the precache, so the
    home-screen launch URL `/?source=pwa` falls back to the cached shell
    (`25c41b9c7b`, 999.12)
  - sharp apple-touch icon (`119dc88c91`, 999.7)
- **Open:**
  - 999.12: lazy chunks are only cached once used online after a deploy;
    candidate: cache all non-huge chunks when a new version installs
  - 999.17 part A: serve the mobile app to tablets (iPadOS reports a
    desktop user agent)

## pr/42-mobile-debug-tools (new)

- **Scope:** a debug back channel for live debugging on devices without a
  remote inspector: an auth-gated debug-log ingestion endpoint
  (`mobile-debug-log`) and a token-gated remote-eval bridge
  (`mobile-debug-eval`, disabled unless `AFFINE_MOBILE_DEBUG_EVAL_ENABLED`),
  their mobile clients (poll loop, log capture and the keyboard-toolbar
  instrumentation), the mobile DI framework handle in debug builds,
  `scripts/mobile-debug-eval.sh` and `docs/mobile-debug-workflow.md`.
- **Commits:** `dc2ed070b3`, `6b11a1f23b`, `fea59ab6f7`, `4884b16b0c`,
  `eaeed97f96`, `b9ebebb603`, `810cf42fb0`, plus the debug-log parts of
  `bc74d3e60a`.
- **Upstream:** not opened; probably fork-only, or offered as a dev-only
  feature.
- **Goal:** generalise it into a back channel any client can use (desktop
  web, mobile web, PWA), so agentic coding gets direct, fast access to a
  live environment. Planned for after the reorganisation, in this branch
  (rename to `pr/42-debug-backchannel`, endpoints to `/api/debug-eval`):
  1. **Security (do first):** `/pending` and `/result` are currently
     `@Public()` and the mobile app installs the poll loop for every user,
     so with eval enabled a submitted snippet runs on whichever user's
     device polls first. Require a signed-in client, deliver only to an
     allow-listed user from server config, keep the token for submitting,
     log every command, and start the poll loop only when the server says
     the channel is enabled for that user.
  2. **Desktop web client:** move the client to a shared module and install
     it from the web app as well (no console snippet needed).
  3. **Client targeting:** the server holds one pending command and the
     first poller takes it, so a desktop tab and a phone race. Clients
     register (id, platform, user agent, page, user); commands target a
     client, or the only one connected; CLI gets `clients` and `--client`.
  4. **Long-polling** instead of 1-2 s polling: instant delivery, less idle
     traffic, copes with throttled background tabs.
  5. **Agent tooling:** an MCP server wrapping the CLI
     (`list_clients`, `eval`), and the debug-log endpoint as a `logs` tool.
  6. **Electron (later, if needed):** its renderer is not served from the
     server's origin, so it needs the configured server URL and CORS.

## pr/50-store-parent-index (new)

- **Scope:** BlockSuite store looks up block parents and the root from a
  cached index instead of scanning the whole doc (`1e77934142`). About a
  third of per-keystroke JavaScript on long pages; full re-render was
  quadratic.
- **Upstream:** not opened; good upstream candidate on its own.

## pr/51-toast-container (new)

- **Scope:** `toast()` recreates its container once the editor it was
  attached to is gone (`3561bf0cf0`).
- **Upstream:** not opened; upstream candidate.

## pr/N-build

- **Scope:** fork build and deploy only: Dockerfile (local-context build,
  `BUILD_VERSION`, `BUILD_JOBS`), `.dockerignore`, rebuild scripts
  (`watch-compose-rebuild.sh`), commit SHA in the HTML for Docker builds.
- **Upstream:** fork-only.
