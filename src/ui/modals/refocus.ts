// Where keyboard focus goes after an editor closed and the button that opened it is gone (a
// 「+ 后续进度」 of a panel that now shows the new achievement, an 「编辑」 of a deleted one).

type Find = () => HTMLElement | null;

/** The achievement's button on the tree, when it is on screen. */
export const treeNode = (id: string): Find => () =>
  document.querySelector<HTMLElement>(`.node[data-id="${id.replace(/["\\]/g, '\\$&')}"]`);

/** The tree viewport (tabIndex -1), so the next Tab lands on the tree. */
export const treeView: Find = () => document.getElementById('vp');

/**
 * Once the closing render has settled, focus the first target found, but only when focus fell to
 * <body> (the modal's own restore found no opener to go back to).
 */
export function refocusAfterClose(...targets: Find[]): void {
  requestAnimationFrame(() => {
    const a = document.activeElement;
    if (a && a !== document.body) return;
    for (const find of targets) {
      const el = find();
      if (!el) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
  });
}
