import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Sticky action row at the bottom of the scroll area (.dact). */
  footer?: ReactNode;
  /** Id for the heading (aria-labelledby); generated when omitted. */
  labelId?: string;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image']);

/** A field where Esc should first only leave the field (so a half-typed value is not thrown away). */
function isTextField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(el.type);
}

/**
 * Tabbable elements in DOM order. Skips content of closed <details>, [hidden] subtrees and (where
 * there is layout, so not in jsdom) anything CSS hides, and keeps one radio per group (the checked
 * one, else the first), as the browser's Tab order does.
 */
function tabbables(box: HTMLElement): HTMLElement[] {
  const seenGroups = new Set<string>();
  const laidOut = box.getClientRects().length > 0;
  const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => {
    if (el.closest('[hidden], [inert]')) return false;
    if (laidOut && el.getClientRects().length === 0) return false;
    const det = el.parentElement?.closest('details');
    if (det && !det.open && !(el.tagName === 'SUMMARY' && el.parentElement === det)) return false;
    return true;
  });
  return all.filter(el => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true;
    const key = el.name;
    if (seenGroups.has(key)) return false;
    const group = all.filter((o): o is HTMLInputElement => o instanceof HTMLInputElement && o.type === 'radio' && o.name === key);
    const pick = group.find(o => o.checked) ?? group[0];
    if (pick !== el) return false;
    seenGroups.add(key);
    return true;
  });
}

/**
 * The shared modal shell: backdrop, framed box, heading with ×, a scroll area and an optional
 * sticky action row. Traps Tab, closes on Esc (inside a text field the first Esc only leaves the
 * field), focuses the first [data-autofocus] / [autofocus] element (or ×) on open, gives focus
 * back to the opener on close, and closes on a backdrop click only when the press started and
 * ended on the backdrop.
 */
export function Modal({ title, onClose, children, footer, labelId }: ModalProps) {
  const autoId = useId();
  const headId = labelId ?? `mh${autoId.replace(/:/g, '')}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  // read during the first render: by the time effects run, an autoFocus child already took focus
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  const press = useRef({ down: false, up: false });

  useEffect(() => {
    const box = boxRef.current;
    if (box && !box.contains(document.activeElement)) {
      const first = box.querySelector<HTMLElement>('.mscroll [data-autofocus], .mscroll [autofocus]') ?? box.querySelector<HTMLElement>('.mhead button');
      first?.focus({ preventScroll: true });
    }
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const box = boxRef.current;
      if (!box) return;
      if (e.key === 'Escape') {
        // Esc while an IME (pinyin) composition is open only cancels the composition
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        const a = document.activeElement;
        if (isTextField(a) && box.contains(a)) {
          box.focus({ preventScroll: true });
          return;
        }
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = tabbables(box);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      const a = document.activeElement;
      const inside = a instanceof Node && box.contains(a);
      if (!inside || a === box) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && a === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && a === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="modal"
      onPointerDown={e => { press.current = { down: e.target === e.currentTarget, up: false }; }}
      onPointerUp={e => { press.current.up = e.target === e.currentTarget; }}
      onClick={e => {
        const p = press.current;
        press.current = { down: false, up: false };
        if (e.target === e.currentTarget && p.down && p.up) onClose();
      }}
    >
      <div ref={boxRef} className="mbox mcp" role="dialog" aria-modal="true" aria-labelledby={headId} tabIndex={-1}>
        <div className="mhead">
          <h2 id={headId}>{title}</h2>
          <button className="btn sm sq" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <div className="mscroll">
          {children}
          {footer && <div className="dact">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
