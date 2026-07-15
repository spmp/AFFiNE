import '../services/journal-carry-forward';

import { describe, expect, test, vi } from 'vitest';

import { JournalService } from '../services/journal';

const createJournalService = (options?: {
  existingDocs?: unknown[];
  journalTemplateDocId?: string;
  pageTemplateDocId?: string;
  enablePageTemplate?: boolean;
  duplicateFromTemplate?: ReturnType<typeof vi.fn>;
  applyCarryForward?: ReturnType<typeof vi.fn>;
}) => {
  const docRecord = {
    id: 'journal-doc',
    setMeta: vi.fn(),
  };
  const store = {
    ['allJournalDates$']: {},
    watchDocJournalDate: vi.fn(),
    setDocJournalDate: vi.fn(),
    removeDocJournalDate: vi.fn(),
    ['docsByJournalDate$']: vi.fn(() => ({
      value: options?.existingDocs ?? [],
    })),
  };
  const docsService = {
    createDoc: vi.fn(() => docRecord),
    duplicateFromTemplate: options?.duplicateFromTemplate ?? vi.fn(),
  };
  const templateDocService = {
    setting: {
      ['enablePageTemplate$']: { value: options?.enablePageTemplate ?? false },
      ['pageTemplateDocId$']: { value: options?.pageTemplateDocId },
      ['journalTemplateDocId$']: { value: options?.journalTemplateDocId },
    },
  };
  const carryForwardService = {
    applyCarryForward: options?.applyCarryForward ?? vi.fn(),
  };

  const service = Object.create(JournalService.prototype) as JournalService & {
    store: typeof store;
    docsService: typeof docsService;
    templateDocService: typeof templateDocService;
    carryForwardService: typeof carryForwardService;
  };
  service.store = store;
  service.docsService = docsService;
  service.templateDocService = templateDocService;
  service.carryForwardService = carryForwardService;

  return {
    docRecord,
    store,
    docsService,
    carryForwardService,
    service,
  };
};

describe('JournalService carry-forward orchestration', () => {
  test('does not rerun carry-forward when journal already exists', () => {
    const existingDoc = { id: 'existing-journal' };
    const { service, docsService, carryForwardService } = createJournalService({
      existingDocs: [existingDoc],
    });

    expect(service.ensureJournalByDate('2026-06-17')).toBe(existingDoc);
    expect(docsService.createDoc).not.toHaveBeenCalled();
    expect(carryForwardService.applyCarryForward).not.toHaveBeenCalled();
  });

  test('runs carry-forward after journal template duplication completes', async () => {
    let resolveTemplate!: () => void;
    const duplicateFromTemplate = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveTemplate = resolve;
        })
    );
    const applyCarryForward = vi.fn();
    const { service } = createJournalService({
      journalTemplateDocId: 'template-doc',
      duplicateFromTemplate,
      applyCarryForward,
    });

    service.ensureJournalByDate('2026-06-17');
    await Promise.resolve();

    expect(applyCarryForward).not.toHaveBeenCalled();

    resolveTemplate();
    await Promise.resolve();
    await Promise.resolve();

    expect(duplicateFromTemplate).toHaveBeenCalledWith(
      'template-doc',
      'journal-doc'
    );
    expect(applyCarryForward).toHaveBeenCalledWith('journal-doc', '2026-06-17');
  });

  test('runs carry-forward for a new journal without templates', async () => {
    const applyCarryForward = vi.fn();
    const { service } = createJournalService({ applyCarryForward });

    service.ensureJournalByDate('2026-06-17');
    await Promise.resolve();
    await Promise.resolve();

    expect(applyCarryForward).toHaveBeenCalledWith('journal-doc', '2026-06-17');
  });

  test('runs carry-forward when an existing page is marked as a journal', async () => {
    const applyCarryForward = vi.fn();
    const { service, store } = createJournalService({ applyCarryForward });

    service.setJournalDate('manual-journal-doc', '2026-06-17');
    await Promise.resolve();

    expect(store.setDocJournalDate).toHaveBeenCalledWith(
      'manual-journal-doc',
      '2026-06-17'
    );
    expect(applyCarryForward).toHaveBeenCalledWith(
      'manual-journal-doc',
      '2026-06-17'
    );
  });
});
