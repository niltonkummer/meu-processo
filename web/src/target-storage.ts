export type StoredTargetType = "name" | "cpf" | "cnpj";

export interface StoredTarget {
  id: string;
  type: StoredTargetType;
  value: string;
  displayValue: string;
}

const STORAGE_KEY = "meu-processo.targets.v1";

const isStoredTarget = (value: unknown): value is StoredTarget => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    ["name", "cpf", "cnpj"].includes(String(record.type)) &&
    typeof record.value === "string" &&
    typeof record.displayValue === "string"
  );
};

export const loadTargets = (storage: Storage): StoredTarget[] => {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredTarget) : [];
  } catch {
    return [];
  }
};

export const saveTarget = (storage: Storage, target: StoredTarget) => {
  const current = loadTargets(storage).filter((item) => item.id !== target.id);
  storage.setItem(STORAGE_KEY, JSON.stringify([...current, target]));
};
