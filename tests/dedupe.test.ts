import { describe, expect, it } from "vitest";
import { DedupeStore } from "../src/state/dedupe.js";

describe("DedupeStore", () => {
  it("marks first event as non-duplicate and second as duplicate within TTL", () => {
    const store = new DedupeStore();
    const now = 1_000;

    expect(store.isDuplicateAndMark("evt-1", 5_000, now)).toBe(false);
    expect(store.isDuplicateAndMark("evt-1", 5_000, now + 100)).toBe(true);
  });

  it("expires events after TTL", () => {
    const store = new DedupeStore();
    const now = 1_000;

    expect(store.isDuplicateAndMark("evt-1", 100, now)).toBe(false);
    expect(store.isDuplicateAndMark("evt-1", 100, now + 200)).toBe(false);
  });
});
