export class PerKeySerialQueue {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly onError: ((error: unknown, key: string) => void) | undefined;

  constructor(onError?: (error: unknown, key: string) => void) {
    this.onError = onError;
  }

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(key) ?? Promise.resolve();

    const next = previous
      .catch(() => {
        // A previous failure should not block the chain for this key.
      })
      .then(task)
      .catch((error) => {
        this.onError?.(error, key);
      })
      .finally(() => {
        if (this.chains.get(key) === next) {
          this.chains.delete(key);
        }
      });

    this.chains.set(key, next);
    return next;
  }

  pendingKeys(): number {
    return this.chains.size;
  }
}
