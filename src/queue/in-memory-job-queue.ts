export type QueueHandler<T> = (payload: T) => Promise<void>;

export class InMemoryJobQueue<T> {
  private readonly pending: T[] = [];
  private running = 0;

  constructor(
    private readonly concurrency: number,
    private readonly handler: QueueHandler<T>,
  ) {}

  enqueue(payload: T): void {
    this.pending.push(payload);
    this.drain();
  }

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const next = this.pending.shift();
      if (next === undefined) {
        return;
      }

      this.running += 1;
      void this.handler(next)
        .catch(() => {
          // handler owns failure persistence
        })
        .finally(() => {
          this.running -= 1;
          this.drain();
        });
    }
  }
}
