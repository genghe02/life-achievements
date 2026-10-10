import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { isDateStr, isFuture, today } from '../../domain/dates';
import { LIMITS } from '../../store/inputs';
import { useStore } from '../../store/store';

interface Props {
  id: string;
  /** The stored date and note (the fields keep their own drafts while being edited). */
  date: string;
  note: string;
  /** Set to a function that saves the note being typed (the undo button calls it first). */
  flushRef?: RefObject<(() => void) | null>;
}

/** 达成日期 and 感想 of a done achievement, saved on change (date) and on blur (note). */
export function DoneFields({ id, date, note, flushRef }: Props) {
  const [dateDraft, setDateDraft] = useState(date);
  const [noteDraft, setNoteDraft] = useState(note);
  const [seen, setSeen] = useState({ date, note });
  const [err, setErr] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const noteRef = useRef(note);
  // The stored note the draft started from, and whether it was typed in since. A draft is only
  // saved over the note it started from: an import or another tab that replaced the note wins.
  const baseRef = useRef(note);
  const dirtyRef = useRef(false);

  // the stored values changed (our own save, or an import): follow them unless it is our draft
  if (seen.date !== date || seen.note !== note) {
    if (seen.date !== date) setDateDraft(date);
    if (seen.note !== note && noteDraft.trim() !== note) setNoteDraft(note);
    setSeen({ date, note });
  }

  useEffect(() => {
    noteRef.current = noteDraft;
  }, [noteDraft]);

  // the stored note changed (our save, or an import): the draft has followed it, see above
  useLayoutEffect(() => {
    baseRef.current = note;
    dirtyRef.current = false;
  }, [note]);

  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(0), 2500);
    return () => clearTimeout(t);
  }, [savedAt]);

  // An unsaved note is kept when the panel closes or switches node without a blur (iOS keeps the
  // field focused when a button is tapped) and when the page is hidden or closed.
  useEffect(() => {
    const flush = () => {
      writeNote();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    // These must run before the persistence layer's flush listeners (document visibilitychange, window
    // pagehide, registered at startup). visibilitychange bubbles, so capturing it on window runs first
    // in every engine; pagehide (fired after it on unload) relies on capture listeners running first
    // at the target.
    window.addEventListener('visibilitychange', onVisibility, true);
    window.addEventListener('pagehide', flush, true);
    if (flushRef) flushRef.current = flush;
    return () => {
      window.removeEventListener('visibilitychange', onVisibility, true);
      window.removeEventListener('pagehide', flush, true);
      if (flushRef?.current === flush) flushRef.current = null;
      flush();
    };
    // writeNote only reads refs and the store
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, flushRef]);

  /** `final` on blur: an incomplete or invalid date is reported and reverted. While typing, only a valid date is saved. */
  const saveDate = (v: string, final: boolean) => {
    const cur = useStore.getState().data.done[id];
    if (!cur) return;
    if (v === cur.date) {
      if (final) setErr('');
      return;
    }
    if (!final && !(isDateStr(v) && !isFuture(v))) return;
    const r = useStore.getState().setDoneInfo(id, { date: v });
    if (r.ok) {
      setErr('');
    } else {
      setErr(r.error);
      setDateDraft(cur.date);
    }
  };

  /** Save the draft if it was typed in and the stored note is still the one it started from. */
  function writeNote() {
    const cur = useStore.getState().data.done[id];
    const v = noteRef.current;
    if (!cur || !dirtyRef.current) return null;
    if ((cur.note ?? '') !== baseRef.current) {
      dirtyRef.current = false;
      return null;
    }
    if (v.trim() === (cur.note ?? '')) return null;
    const r = useStore.getState().setDoneInfo(id, { note: v });
    if (r.ok) {
      baseRef.current = useStore.getState().data.done[id]?.note ?? '';
      dirtyRef.current = false;
    }
    return r;
  }

  const saveNote = () => {
    const r = writeNote();
    if (!r) return;
    if (r.ok) {
      setErr('');
      setSavedAt(Date.now());
    } else {
      setErr(r.error);
    }
  };

  return (
    <div className="dinfo">
      <label className="field">
        <span className="small">达成日期</span>
        <input
          className="inp num"
          type="date"
          required
          max={today()}
          value={dateDraft}
          onChange={e => {
            setDateDraft(e.target.value);
            saveDate(e.target.value, false);
          }}
          onBlur={e => saveDate(e.target.value, true)}
        />
      </label>
      <label className="field">
        <span className="small">感想（可不填）</span>
        <textarea
          className="inp"
          maxLength={LIMITS.note}
          rows={3}
          placeholder="记下当时的心情，或者想对以后的自己说的话。"
          value={noteDraft}
          onChange={e => {
            noteRef.current = e.target.value;
            dirtyRef.current = true;
            setNoteDraft(e.target.value);
            setSavedAt(0);
          }}
          onBlur={saveNote}
        />
        <span className="fcount small num" aria-hidden="true">{noteDraft.length}/{LIMITS.note}</span>
      </label>
      <p className="ferr small" role="alert">{err}</p>
      <p className="dnote-saved small" role="status">{savedAt ? '感想已保存。' : ''}</p>
    </div>
  );
}
