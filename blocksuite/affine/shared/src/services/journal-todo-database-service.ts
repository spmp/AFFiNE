import { createIdentifier } from '@blocksuite/global/di';
import type { ExtensionType } from '@blocksuite/store';

export interface JournalTodoDatabaseRef {
  refDocId: string;
  refBlockId: string;
}

export interface JournalTodoDatabaseService {
  /**
   * Reads the journal date (`YYYY-MM-DD`) of `docId`, or `undefined` if it
   * isn't a journal doc. Synchronous, current-value read — used to gate the
   * Journal Todo slash-menu command's own visibility (Story 2.4): the
   * command is only offered inside a journal doc.
   */
  getJournalDate: (docId: string) => string | undefined;

  /**
   * Reverse lookup of `getJournalDate`: resolves an existing journal page's
   * docId for a given `YYYY-MM-DD` date, or `undefined` if no journal page
   * for that date exists yet. Deliberately a pure, side-effect-free lookup
   * — unlike the app-level `JournalService.ensureJournalByDate`, this never
   * creates a journal page. Used by Story 2.7's calendar click-navigation
   * (Task 4): jumping to "today's" or "the day it was marked done" journal
   * page should never silently conjure a new page as a side effect of a
   * click.
   */
  getJournalDocId: (date: string) => string | undefined;

  /**
   * Reads the single, workspace-wide "current journal todo database"
   * pointer, or `undefined` if none has been established yet. Whether that
   * pointer still resolves to a live block is the caller's responsibility
   * to verify (it has direct `std`/`store` access; this provider is a thin
   * read/write seam only, not a resolution orchestrator).
   */
  getJournalTodoDatabaseRef: () => JournalTodoDatabaseRef | undefined;

  /**
   * Sets the workspace-wide "current journal todo database" pointer — every
   * future invocation of the Journal Todo command (from any journal, any
   * device) resolves against this same canonical database until it's set
   * again.
   */
  setJournalTodoDatabaseRef: (ref: JournalTodoDatabaseRef | undefined) => void;
}

export const JournalTodoDatabaseProvider =
  createIdentifier<JournalTodoDatabaseService>(
    'AffineJournalTodoDatabaseService'
  );

export function JournalTodoDatabaseExtension(
  service: JournalTodoDatabaseService
): ExtensionType {
  return {
    setup: di => {
      di.addImpl(JournalTodoDatabaseProvider, service);
    },
  };
}
