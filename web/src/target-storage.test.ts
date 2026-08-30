import { describe, expect, it } from "vitest";

import { loadTargets, saveTarget } from "./target-storage";

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
  it("returns an empty list for absent or malformed local data", () => {
    const storage = new MemoryStorage();
    expect(loadTargets(storage)).toEqual([]);

    storage.setItem("meu-processo.targets.v1", "not json");
    expect(loadTargets(storage)).toEqual([]);

    storage.setItem("meu-processo.targets.v1", JSON.stringify({ nope: true }));
    expect(loadTargets(storage)).toEqual([]);
  });

  it("stores targets locally and replaces the same deterministic id", () => {
    const storage = new MemoryStorage();
    const original = {
      id: "name_abc",
      type: "name" as const,
      value: "Pessoa Exemplo",
      displayValue: "Pessoa Exemplo",
    };

    saveTarget(storage, original);
    saveTarget(storage, { ...original, value: "Pessoa Exemplo Atualizada" });

    expect(loadTargets(storage)).toEqual([
      { ...original, value: "Pessoa Exemplo Atualizada" },
    ]);
  });

  it("ignores invalid entries without discarding valid local targets", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "meu-processo.targets.v1",
      JSON.stringify([
        {
          id: "cpf_abc",
          type: "cpf",
          value: "123.456.789-09",
          displayValue: "***.***.***-09",
        },
        { id: 12, type: "name" },
        null,
        "invalid",
        { id: "x", type: "email", value: "x", displayValue: "x" },
        { id: "x", type: "name", value: 12, displayValue: "x" },
        { id: "x", type: "name", value: "x", displayValue: 12 },
      ]),
    );

    expect(loadTargets(storage)).toHaveLength(1);
  });
});
