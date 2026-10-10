// STUB (shell): the PWA module replaces this with service-worker registration and the update
// prompt. Keep the exports: main.tsx calls setupPwa(), ui/actions.ts calls requestPersist().

/** Register the service worker and watch for updates. */
export function setupPwa(): void {
  // stub
}

/** Ask the browser to keep IndexedDB data under storage pressure. Resolves true when it will. */
export async function requestPersist(): Promise<boolean> {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.persist) return false;
    if (await s.persisted?.()) return true;
    return await s.persist();
  } catch {
    return false;
  }
}
