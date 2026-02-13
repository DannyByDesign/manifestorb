interface QueueEntry {
  run: () => void;
}

class Semaphore {
  private inFlight = 0;
  private readonly queue: QueueEntry[] = [];

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<() => void> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight += 1;
      return () => this.release();
    }

    await new Promise<void>((resolve) => {
      this.queue.push({ run: resolve });
    });

    this.inFlight += 1;
    return () => this.release();
  }

  private release() {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.queue.shift();
    next?.run();
  }
}

const throttles = new Map<string, Semaphore>();

function getThrottle(key: string, maxConcurrent: number): Semaphore {
  const current = throttles.get(key);
  if (current) return current;
  const created = new Semaphore(Math.max(1, maxConcurrent));
  throttles.set(key, created);
  return created;
}

export async function withToolThrottle<T>(params: {
  key: string;
  maxConcurrent: number;
  operation: string;
  run: () => Promise<T>;
}): Promise<T> {
  const throttle = getThrottle(`${params.key}:${params.operation}`, params.maxConcurrent);
  const release = await throttle.acquire();
  try {
    return await params.run();
  } finally {
    release();
  }
}
