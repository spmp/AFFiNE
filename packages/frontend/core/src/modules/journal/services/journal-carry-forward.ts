import { type DeltaInsert, Text } from '@blocksuite/affine/store';
import type { AffineTextAttributes } from '@blocksuite/affine-shared/types';
import { Service } from '@toeverything/infra';

import type { DocsService } from '../../doc';
import {
  buildCarryForwardPlan,
  type CarryForwardEntry,
  createTodoOutstandingTaskCandidate,
  type OutstandingTaskCandidate,
  resolveOutstandingTasks,
} from '../utils/outstanding-tasks';

const OUTSTANDING_TASKS_HEADING = 'Outstanding Tasks';

const getTextValue = (value: unknown) => {
  if (!value) {
    return '';
  }
  return String(value).trim();
};

const isPriorJournal = (journal: unknown, targetDate: string) =>
  typeof journal === 'string' && journal < targetDate;

export class JournalCarryForwardService extends Service {
  constructor(private readonly docsService: DocsService) {
    super();
  }

  private async collectPriorJournalTodoCandidates(
    targetDocId: string,
    targetDate: string
  ): Promise<OutstandingTaskCandidate[]> {
    const records = this.docsService.list.docs$.value.filter(record => {
      if (record.id === targetDocId || record.trash$.value) {
        return false;
      }
      return isPriorJournal(record.properties$.value.journal, targetDate);
    });
    const candidates: OutstandingTaskCandidate[] = [];

    for (const record of records) {
      const { doc, release } = this.docsService.open(record.id);
      try {
        await doc.waitForSyncReady();
        const listBlocks = doc.blockSuiteDoc.getBlocksByFlavour('affine:list');
        for (const block of listBlocks) {
          const model = block.model;
          if (model.props.type !== 'todo') {
            continue;
          }
          const title = getTextValue(model.props.text);
          candidates.push(
            createTodoOutstandingTaskCandidate({
              docId: record.id,
              blockId: model.id,
              title,
              checked: !!model.props.checked,
            })
          );
        }
      } finally {
        release();
      }
    }

    return candidates;
  }

  private hasCarryForwardSection(targetDocId: string) {
    const { doc, release } = this.docsService.open(targetDocId);
    try {
      return doc.blockSuiteDoc
        .getBlocksByFlavour('affine:paragraph')
        .some(
          block =>
            getTextValue(block.model.props.text) === OUTSTANDING_TASKS_HEADING
        );
    } finally {
      release();
    }
  }

  private entryText(entry: CarryForwardEntry) {
    const context =
      entry.context.length > 0 ? ` - ${entry.context.join(' / ')}` : '';
    return new Text([
      {
        insert: entry.title,
        attributes: {
          reference: {
            type: 'LinkedPage',
            pageId: entry.reference.pageId,
            params: entry.reference.params,
          },
        },
      },
      { insert: context },
    ] as DeltaInsert<AffineTextAttributes>[]);
  }

  private async appendCarryForwardEntries(
    targetDocId: string,
    entries: CarryForwardEntry[]
  ) {
    if (entries.length === 0 || this.hasCarryForwardSection(targetDocId)) {
      return;
    }

    const { doc, release } = this.docsService.open(targetDocId);
    try {
      await doc.waitForSyncReady();
      const note = doc.blockSuiteDoc.getBlocksByFlavour('affine:note').at(0);
      if (!note) {
        return;
      }
      doc.blockSuiteDoc.addBlock(
        'affine:paragraph',
        {
          type: 'h2',
          text: new Text(OUTSTANDING_TASKS_HEADING),
        },
        note.model.id
      );
      for (const entry of entries) {
        doc.blockSuiteDoc.addBlock(
          'affine:paragraph',
          {
            text: this.entryText(entry),
          },
          note.model.id
        );
      }
    } finally {
      release();
    }
  }

  async applyCarryForward(targetDocId: string, targetDate: string) {
    const candidates = await this.collectPriorJournalTodoCandidates(
      targetDocId,
      targetDate
    );
    const { tasks } = resolveOutstandingTasks(candidates);
    const plan = buildCarryForwardPlan(tasks);
    await this.appendCarryForwardEntries(targetDocId, plan.entries);
  }
}
