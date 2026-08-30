export interface RequestRateLimiter {
  allow(key: string, limit: number, windowMs: number): boolean;
}
