import { describe, expect, it, vi } from "vitest";

import { clearLegacyTargets } from "./target-storage";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("target storage", () => {
  it("removes the legacy payload that may contain name, CPF or CNPJ", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "meu-processo.targets.v1",
      JSON.stringify([{ type: "cpf", value: "123.456.789-09" }]),
    );
    storage.setItem("unrelated.preference", "keep");

    clearLegacyTargets(storage);

    expect(storage.getItem("meu-processo.targets.v1")).toBeNull();
    expect(storage.getItem("unrelated.preference")).toBe("keep");
  });

  it("is safe when storage is absent, blocked or already clean", () => {
    const storage = new MemoryStorage();
    expect(() => clearLegacyTargets(storage)).not.toThrow();

    vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(() => clearLegacyTargets(storage)).not.toThrow();
  });
});
