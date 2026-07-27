import { FrameIcon, PageIcon, TableIcon } from '@blocksuite/icons/rc';
import { effect, Entity, LiveData } from '@toeverything/infra';
import { catchError, EMPTY, map, of, switchMap, throttleTime } from 'rxjs';

import type { DocsService } from '../../doc';
import type { DocDisplayMetaService } from '../../doc-display-meta';
import type { DocsSearchService } from '../../docs-search';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { QuickSearchItem } from '../types/item';

export interface CrossDocReferenceCandidatePayload {
  docId: string;
  blockIds: [string];
  flavour: 'affine:frame' | 'affine:database' | 'affine:note';
}

/**
 * Surfaces every Frame/Database/Note block in the workspace, except the
 * ones living in `excludeDocId` (the doc currently being edited) — powers
 * Story 0.3's cross-doc reference picker (Frame/Database), extended for
 * Note by Story 0.5. Reuses the existing QuickSearch dialog infrastructure
 * (see `QuickSearchProvider`) rather than a bespoke UI.
 */
export class CrossDocReferenceQuickSearchSession
  extends Entity<{
    excludeDocId: string;
    allowedFlavours?: ('affine:frame' | 'affine:database' | 'affine:note')[];
  }>
  implements
    QuickSearchSession<'cross-doc-reference', CrossDocReferenceCandidatePayload>
{
  constructor(
    private readonly docsSearchService: DocsSearchService,
    private readonly docsService: DocsService,
    private readonly docDisplayMetaService: DocDisplayMetaService
  ) {
    super();
  }

  items$ = new LiveData<
    QuickSearchItem<'cross-doc-reference', CrossDocReferenceCandidatePayload>[]
  >([]);

  isLoading$ = new LiveData(false);
  error$ = new LiveData<any>(null);

  query = effect(
    throttleTime<string>(300, undefined, { leading: false, trailing: true }),
    switchMap(query => {
      if (!query) return of([]);

      return this.docsSearchService
        .watchCrossDocReferenceCandidates(
          this.props.excludeDocId,
          query,
          this.props.allowedFlavours
        )
        .pipe(
          map(candidates => {
            const resolved = candidates
              .map(candidate => {
                const docRecord = this.docsService.list.doc$(
                  candidate.docId
                ).value;
                if (!docRecord) return null;

                const { title: pageTitle } =
                  this.docDisplayMetaService.getDocDisplayMeta(docRecord);
                const blockTitle =
                  candidate.label ||
                  (candidate.flavour === 'affine:frame'
                    ? 'Untitled Frame'
                    : candidate.flavour === 'affine:database'
                      ? 'Untitled Database'
                      : 'Untitled Note');

                return { candidate, pageTitle, blockTitle };
              })
              .filter((r): r is NonNullable<typeof r> => !!r);

            // Grouped by page first, then by the block's own name within
            // each page — `container.tsx` sorts groups/items by descending
            // numeric score, so a locale-aware sort here is translated into
            // per-group and per-item scores below (highest score = shown
            // first) rather than relying on any natural array order.
            resolved.sort(
              (a, b) =>
                a.pageTitle.localeCompare(b.pageTitle) ||
                a.blockTitle.localeCompare(b.blockTitle)
            );

            const pageOrder: string[] = [];
            for (const { candidate } of resolved) {
              if (!pageOrder.includes(candidate.docId)) {
                pageOrder.push(candidate.docId);
              }
            }
            const pageScore = (docId: string) =>
              pageOrder.length - pageOrder.indexOf(docId);

            const itemIndexWithinPage = new Map<string, number>();

            return resolved.map(({ candidate, pageTitle, blockTitle }) => {
              const indexWithinPage =
                itemIndexWithinPage.get(candidate.docId) ?? 0;
              itemIndexWithinPage.set(candidate.docId, indexWithinPage + 1);

              return {
                id: `cross-doc-reference:${candidate.docId}:${candidate.blockId}`,
                source: 'cross-doc-reference',
                group: {
                  id: candidate.docId,
                  label: pageTitle,
                  score: pageScore(candidate.docId),
                },
                score: -indexWithinPage,
                label: {
                  title: blockTitle,
                  subTitle: pageTitle,
                },
                icon:
                  candidate.flavour === 'affine:frame'
                    ? FrameIcon
                    : candidate.flavour === 'affine:database'
                      ? TableIcon
                      : PageIcon,
                payload: {
                  docId: candidate.docId,
                  blockIds: [candidate.blockId] as [string],
                  flavour: candidate.flavour,
                },
              } as QuickSearchItem<
                'cross-doc-reference',
                CrossDocReferenceCandidatePayload
              >;
            });
          }),
          catchError(error => {
            // Logged so a genuine failure (indexer error, schema mismatch)
            // is distinguishable from an honestly empty search result.
            console.error('[cross-doc-reference] search failed', error);
            this.error$.next(error);
            return of([]);
          })
        );
    }),
    map(items => {
      this.items$.next(items);
    }),
    catchError(() => EMPTY)
  );

  override dispose(): void {
    this.query.unsubscribe();
  }
}
