export async function runInBatches<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const safeConcurrency = Math.max(1, concurrency);
  for (let i = 0; i < items.length; i += safeConcurrency) {
    const slice = items.slice(i, i + safeConcurrency);
    await Promise.all(slice.map((item) => worker(item)));
  }
}

export async function mapInBatches<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  if (items.length === 0) return [];
  const safeConcurrency = Math.max(1, concurrency);
  const out: U[] = [];
  for (let i = 0; i < items.length; i += safeConcurrency) {
    const slice = items.slice(i, i + safeConcurrency);
    const mapped = await Promise.all(slice.map((item) => mapper(item)));
    out.push(...mapped);
  }
  return out;
}
