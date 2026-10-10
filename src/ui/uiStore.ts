// Transient UI state shared between the tree, the detail panel and the modals.
// Nothing here is persisted.

import { create } from 'zustand';

export type ModalState =
  | null
  | { kind: 'trade' }
  | { kind: 'menu' }
  /** New achievement (no id, optional preselected parent) or edit an existing one. */
  | { kind: 'node'; id?: string; areaId: string; parent?: string }
  /** New area (no id) or edit an existing one. */
  | { kind: 'area'; id?: string };

export interface UiState {
  /** Selected achievement id. */
  sel: string | null;
  /** Phone: the bottom sheet is showing the area overview (nothing selected). */
  overview: boolean;
  modal: ModalState;
  /** Arrange mode: nodes can be dragged to other grid cells. */
  arrange: boolean;
  /** Bumped to ask the tree to scroll a node into the middle of the visible area. */
  centerReq: { id: string; seq: number } | null;

  select(id: string | null): void;
  showOverview(on: boolean): void;
  /** Select and centre a node (the caller switches area first if needed). */
  focusNode(id: string): void;
  openModal(m: Exclude<ModalState, null>): void;
  closeModal(): void;
  setArrange(on: boolean): void;
}

export const useUi = create<UiState>()((set, get) => ({
  sel: null,
  overview: false,
  modal: null,
  arrange: false,
  centerReq: null,
  select: id => set({ sel: id, overview: false }),
  showOverview: on => set({ overview: on, sel: on ? null : get().sel }),
  focusNode: id => set({ sel: id, overview: false, centerReq: { id, seq: (get().centerReq?.seq ?? 0) + 1 } }),
  openModal: m => set({ modal: m }),
  closeModal: () => set({ modal: null }),
  setArrange: on => set({ arrange: on }),
}));
