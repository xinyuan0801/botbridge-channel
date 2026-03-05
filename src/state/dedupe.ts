export class DedupeStore {
  private readonly expirations = new Map<string, number>();
  private lastSweepAt = 0;

  isDuplicateAndMark(key: string, ttlMs: number, now = Date.now()): boolean {
    this.sweep(now);

    const existing = this.expirations.get(key);
    if (existing !== undefined && existing > now) {
      return true;
    }

    this.expirations.set(key, now + ttlMs);
    return false;
  }

  size(now = Date.now()): number {
    this.sweep(now);
    return this.expirations.size;
  }

  private sweep(now: number): void {
    // Avoid sweeping on every request while still keeping map bounded.
    if (now - this.lastSweepAt < 1000) {
      return;
    }

    this.lastSweepAt = now;
    for (const [key, expiry] of this.expirations) {
      if (expiry <= now) {
        this.expirations.delete(key);
      }
    }
  }
}
