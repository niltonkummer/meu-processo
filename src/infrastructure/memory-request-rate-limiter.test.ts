import { describe, expect, it } from "vitest";

import { MemoryRequestRateLimiter } from "./memory-request-rate-limiter.js";

describe("MemoryRequestRateLimiter", () => {
  it("limits each key inside a window and resets after it", () => {
    let now = 1_000;
    const limiter = new MemoryRequestRateLimiter(() => now);

    expect(limiter.allow("search:user_alpha", 2, 60_000)).toBe(true);
    expect(limiter.allow("search:user_alpha", 2, 60_000)).toBe(true);
    expect(limiter.allow("search:user_alpha", 2, 60_000)).toBe(false);
    expect(limiter.allow("search:user_beta", 2, 60_000)).toBe(true);

    now = 61_000;
    expect(limiter.allow("search:user_alpha", 2, 60_000)).toBe(true);
  });

  it("fails closed for invalid limits", () => {
    const limiter = new MemoryRequestRateLimiter(() => 1_000);

    expect(limiter.allow("key", 0, 60_000)).toBe(false);
    expect(limiter.allow("key", 1, 0)).toBe(false);
  });
});
