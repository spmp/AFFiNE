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
