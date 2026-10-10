// Another tab of the app saved newer data and this one took it over (see store/persist.ts). When
// changes made here could not be saved because of that, say so.

import { icon } from '../../art/pixel';
import { onExternalData } from '../../store/store';
import { resetHud } from './hudFx';
import { toast } from './toastQueue';

export const LOST_TOAST = { l1: '别的窗口改过数据', l2: '这里刚才的改动没保存，请重做。' } as const;

/** Start listening; returns the stop function. */
export function watchOtherTabs(): () => void {
  return onExternalData(lost => {
    resetHud();
    if (lost) toast({ icon: icon('clock'), kind: 'error', ...LOST_TOAST });
  });
}
