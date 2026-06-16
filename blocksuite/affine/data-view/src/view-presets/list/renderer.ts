import { createIcon } from '../../core/utils/uni-icon.js';
import { listViewModel } from './define.js';
import { ListViewUILogic } from './pc/list-view-ui-logic.js';

export const listViewMeta = listViewModel.createMeta({
  icon: createIcon('DatabaseListViewIcon'),
  pcLogic: () => ListViewUILogic,
  mobileLogic: () => ListViewUILogic,
});
