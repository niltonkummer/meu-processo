import type { RequestRateLimiter } from "../application/request-rate-limiter.js";

interface RateWindow {
  startedAt: number;
  count: number;
}

export class MemoryRequestRateLimiter implements RequestRateLimiter {
  readonly #windows = new Map<string, RateWindow>();

  constructor(private readonly now: () => number = Date.now) {}

  allow(key: string, limit: number, windowMs: number): boolean {
    if (limit <= 0 || windowMs <= 0) return false;

    const now = this.now();
    const current = this.#windows.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      this.#windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= limit) return false;

    current.count += 1;
    return true;
  }
}
