import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the second step stays armed. */
export const ARM_MS = 4000;
/** A second click sooner than this is the tail of a double-click, not a confirmation. */
export const ARM_GUARD_MS = 450;

/**
 * Two-step confirm for destructive buttons: the first press arms `key`, a second press of the same
 * key between ARM_GUARD_MS and ARM_MS later confirms. `press` returns true on the confirming press.
 */
export function useArm() {
  const [armed, setArmed] = useState<string | null>(null);
  const at = useRef(0);

  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const press = useCallback((key: string): boolean => {
    if (armed === key) {
      if (performance.now() - at.current < ARM_GUARD_MS) return false;
      setArmed(null);
      return true;
    }
    at.current = performance.now();
    setArmed(key);
    return false;
  }, [armed]);

  const disarm = useCallback(() => setArmed(null), []);
  return { armed, press, disarm };
}

/** An optional number input's value: empty (or not a number) is undefined. */
export function numOrUndef(v: string): number | undefined {
  const s = v.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}
