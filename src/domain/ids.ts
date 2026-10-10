// Short, URL- and key-safe ids ([a-z0-9_]), unique on one device.

let seq = 0;

function randomPart(len: number): string {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint8Array(len);
    c.getRandomValues(buf);
    return Array.from(buf, b => (b % 36).toString(36)).join('');
  }
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

/** A new id such as `n_mg2k1x0a7f3q`. The prefix says what it names (n node, a area, r reward, t trade). */
export function newId(prefix = 'n'): string {
  seq = (seq + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(2, '0')}${randomPart(4)}`;
}

/** Ids we accept from backups: safe as object keys and DOM attribute values. */
export function isSafeId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) && !(v in Object.prototype);
}
