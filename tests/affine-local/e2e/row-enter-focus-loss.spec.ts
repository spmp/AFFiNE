import { openHomePage } from '@affine-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@affine-test/kit/utils/page-logic';
import { expect, type Page, test } from '@playwright/test';

// Real end-to-end reproduction (2026-09-30/10-01, live bug report) for
// "pressing Enter on a non-empty List view row creates a new row correctly,
// but focus/keyboard is then lost -- typing immediately after does nothing".
//
// Root cause (confirmed live via a `focusout` capture-phase listener + full
// stack trace, not inferred): `ListViewRenderer.splitRowAtCursor` calls
// `splitListCommand`, which internally calls `focusTextModel`/
// `selectTextModel` to update `std.selection`. A database List view row is
// NOT a registered `BlockComponent` in `std.view`'s registry (it's rendered
// by this class's own `repeat()` directive instead), so when
// `RangeBinding._onStdSelectionChanged` tries to sync the native browser
// selection to match, it cannot resolve a real DOM target and calls
// `.clear()` -- wiping out the focus `splitRowAtCursor`'s own
// `focusRowTitle` call had just correctly established a moment earlier.
// This runs as a deferred promise continuation inside `splitListCommand`,
// so it always loses the race against the synchronous `.focus()` call but
// still lands before the next paint -- i.e. it is not a timing fluke, it is
// deterministic, just asynchronous relative to the keypress.
//
// Per Jasper's "real Playwright test BEFORE the fix" operating procedure,
// this drives the actual running app (not a lower-level command-constructed
// harness) and asserts the real-world-observable behavior: can you keep
// typing in the new row right after pressing Enter?

const TEXT = 'hello';
const CONTINUATION = ' world';

test.describe('List view row: focus survives Enter-created new row', () => {
  test.beforeEach(async ({ page }) => {
    await openHomePage(page);
    await clickNewPageButton(page);
    await waitForEditorLoad(page);
    // Focus starts in the (empty) title field after clickNewPageButton;
    // Enter moves the caret into the first paragraph of the body, which is
    // where the "/" slash-command trigger is recognized.
    await page.keyboard.press('Enter');
    await insertListView(page);
  });

  test('typing immediately after Enter lands in the new row, not nowhere', async ({
    page,
  }) => {
    await addRowAndType(page, TEXT);

    const rows = page.locator('.affine-data-view-list-row[data-row-id]');
    const countBefore = await rows.count();

    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(countBefore + 1);

    const newRowTitle = newestRowTitle(page);
    // The regression: focus is cleared asynchronously (a promise
    // continuation inside splitListCommand) shortly AFTER the synchronous
    // focus call that immediately follows Enter -- so a same-tick assertion
    // would pass even on the unfixed code. Typing is the real-world action
    // that actually surfaces the bug: it either lands in the new row (fixed)
    // or lands nowhere/the wrong place (broken).
    await page.keyboard.type(CONTINUATION);
    await expect(newRowTitle).toHaveText(CONTINUATION.trim());
  });
});

async function insertListView(page: Page) {
  await page.keyboard.type('/List View');
  await page.getByText('List View', { exact: true }).first().click();
  await expect(page.locator('affine-database').first()).toBeVisible();
}

function newestRowTitle(page: Page) {
  return page
    .locator('.affine-data-view-list-row[data-row-id]')
    .last()
    .locator('.affine-data-view-list-title');
}

/**
 * Adds a row and types `text` into it.
 */
async function addRowAndType(page: Page, text: string) {
  const rows = page.locator('.affine-data-view-list-row[data-row-id]');
  const countBefore = await rows.count();
  // "+ New Record" briefly enters a transitional/disabled-looking state right
  // after being clicked -- wait for the row count to actually increase rather
  // than assuming the click took effect (see journal-todo-cross-doc.spec.ts
  // and undo-list-view.spec.ts for the same finding).
  await page.locator('.new-record').first().click();
  await expect(rows).toHaveCount(countBefore + 1);
  const title = newestRowTitle(page);
  await title.click();
  await page.keyboard.type(text);
  await expect(title).toHaveText(text);
}
