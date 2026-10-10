import { closeDetail } from './nav';

/** The × of the phone sheet and the sideways dock (hidden on desktop by CSS). */
export function CloseButton() {
  return (
    <button className="btn sm sq dclose" type="button" aria-label="关闭" onClick={closeDetail}>×</button>
  );
}
