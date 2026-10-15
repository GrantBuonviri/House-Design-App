/**
 * Small settings kept in this browser (not in a house). Storage can be
 * missing or blocked, so reads fall back to null and writes are skipped.
 */
export function readStorage(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(store: () => Storage, key: string, value: string) {
  try {
    store().setItem(key, value);
  } catch {}
}
