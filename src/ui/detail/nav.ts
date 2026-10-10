// Navigation from the detail panel: rows jump to an achievement (switching area first when it lives
// in another one), and the close button clears the selection or the phone overview.

import { byId } from '../../domain/rules';
import { useStore } from '../../store/store';
import { useUi } from '../uiStore';

/** The achievement whose heading should take focus once the panel shows it (set by goTo). */
let titleFocusFor: string | null = null;

/** Select and centre an achievement, switching to its area first when needed. */
export function goTo(id: string): void {
  const st = useStore.getState();
  const n = byId(st.data).get(id);
  if (!n) return;
  if (n.areaId !== st.areaId) st.setArea(n.areaId);
  titleFocusFor = id;
  useUi.getState().focusNode(id);
}

/** True once for the achievement goTo just opened: the panel then focuses its heading. */
export function takeTitleFocus(shownId: string | null): boolean {
  const hit = shownId !== null && titleFocusFor === shownId;
  titleFocusFor = null;
  return hit;
}

/** The × of the phone sheet: clears the selection and the overview. */
export function closeDetail(): void {
  useUi.getState().select(null);
}
