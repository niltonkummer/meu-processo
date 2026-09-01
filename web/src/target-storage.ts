const LEGACY_STORAGE_KEY = "meu-processo.targets.v1";

export const clearLegacyTargets = (storage: Storage): void => {
  try {
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage can be blocked by browser privacy settings. There is no fallback:
    // identifiers must never be persisted elsewhere in the browser.
  }
};
