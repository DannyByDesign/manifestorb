import { env } from "@/env";
import Redis from "ioredis";

type RedisSetOptions = {
  ex?: number;
  px?: number;
  nx?: boolean;
  xx?: boolean;
  keepttl?: boolean;
  get?: boolean;
};

type RedisScanOptions = {
  match?: string;
  count?: number;
};

function serializeRedisValue(value: unknown): string | number {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return JSON.stringify(value);
}

function deserializeRedisValue<T>(value: unknown): T {
  if (Array.isArray(value)) {
    return value.map((item) => deserializeRedisValue(item)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => [
      key,
      deserializeRedisValue(item),
    ]);
    return Object.fromEntries(entries) as T;
  }

  if (typeof value !== "string") {
    return value as T;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

function toSetArgs(options?: RedisSetOptions): Array<string | number> {
  if (!options) return [];
  const args: Array<string | number> = [];
  if (typeof options.ex === "number") args.push("EX", options.ex);
  if (typeof options.px === "number") args.push("PX", options.px);
  if (options.nx) args.push("NX");
  if (options.xx) args.push("XX");
  if (options.keepttl) args.push("KEEPTTL");
  if (options.get) args.push("GET");
  return args;
}

const client = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2_000);
      },
      lazyConnect: true,
    })
  : null;

function requireRedisClient(): Redis {
  if (!client) {
    throw new Error("REDIS_URL is not configured");
  }
  return client;
}

class RedisPipelineCompat {
  constructor(private readonly pipeline: ReturnType<Redis["pipeline"]>) {}

  set(key: string, value: unknown, options?: RedisSetOptions): RedisPipelineCompat {
    const serialized = serializeRedisValue(value);
    const args = toSetArgs(options);
    this.pipeline.set(key, serialized as never, ...(args as never[]));
    return this;
  }

  exec() {
    return this.pipeline.exec();
  }
}

export const redis = {
  get<T = unknown>(key: string): Promise<T | null> {
    return requireRedisClient()
      .get(key)
      .then((value) => (value === null ? null : deserializeRedisValue<T>(value)));
  },
  set(
    key: string,
    value: unknown,
    options?: RedisSetOptions,
  ): Promise<string | null> {
    const serialized = serializeRedisValue(value);
    const args = toSetArgs(options);
    return requireRedisClient().set(key, serialized as never, ...(args as never[]));
  },
  del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return Promise.resolve(0);
    return requireRedisClient().del(...keys);
  },
  unlink(...keys: string[]): Promise<number> {
    if (keys.length === 0) return Promise.resolve(0);
    return requireRedisClient().unlink(...keys);
  },
  expire(key: string, seconds: number): Promise<number> {
    return requireRedisClient().expire(key, seconds);
  },
  scan(cursor: number, options?: RedisScanOptions): Promise<[number, string[]]> {
    const args: string[] = [];
    if (options?.match) {
      args.push("MATCH", options.match);
    }
    if (typeof options?.count === "number") {
      args.push("COUNT", String(options.count));
    }
    const scan = requireRedisClient()
      .scan as unknown as (
      cursorArg: string,
      ...scanArgs: string[]
    ) => Promise<[string, string[]]>;
    return scan(String(cursor), ...args).then(([nextCursor, keys]) => [
      Number(nextCursor),
      keys,
    ]);
  },
  keys(pattern: string): Promise<string[]> {
    return requireRedisClient().keys(pattern);
  },
  mget<T = unknown>(...keys: string[]): Promise<Array<T | null>> {
    if (keys.length === 0) return Promise.resolve([]);
    return requireRedisClient()
      .mget(...keys)
      .then((values) =>
        values.map((value) =>
          value === null ? null : deserializeRedisValue<T>(value),
        ),
      );
  },
  hget<T = unknown>(key: string, field: string): Promise<T | null> {
    return requireRedisClient()
      .hget(key, field)
      .then((value) => (value === null ? null : deserializeRedisValue<T>(value)));
  },
  hgetall<T extends Record<string, unknown>>(key: string): Promise<T> {
    return requireRedisClient()
      .hgetall(key)
      .then((value) => deserializeRedisValue<T>(value));
  },
  hset(key: string, values: Record<string, unknown>): Promise<number> {
    const entries = Object.entries(values);
    if (entries.length === 0) return Promise.resolve(0);

    const args = entries.flatMap(([field, value]) => [
      field,
      serializeRedisValue(value),
    ]);
    return requireRedisClient().hset(key, ...(args as never[]));
  },
  hdel(key: string, ...fields: string[]): Promise<number> {
    if (fields.length === 0) return Promise.resolve(0);
    return requireRedisClient().hdel(key, ...fields);
  },
  hincrby(key: string, field: string, increment: number): Promise<number> {
    return requireRedisClient().hincrby(key, field, increment);
  },
  hincrbyfloat(key: string, field: string, increment: number): Promise<string> {
    return requireRedisClient().hincrbyfloat(key, field, increment);
  },
  lpush(key: string, ...values: unknown[]): Promise<number> {
    if (values.length === 0) return Promise.resolve(0);
    const serialized = values.map((value) => serializeRedisValue(value));
    return requireRedisClient().lpush(key, ...(serialized as never[]));
  },
  rpop<T = unknown>(key: string): Promise<T | null> {
    return requireRedisClient()
      .rpop(key)
      .then((value) => (value === null ? null : deserializeRedisValue<T>(value)));
  },
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]> {
    return requireRedisClient()
      .lrange(key, start, stop)
      .then((values) => values.map((value) => deserializeRedisValue<T>(value)));
  },
  lrem(key: string, count: number, value: unknown): Promise<number> {
    return requireRedisClient().lrem(key, count, serializeRedisValue(value) as never);
  },
  llen(key: string): Promise<number> {
    return requireRedisClient().llen(key);
  },
  ping(): Promise<string> {
    return requireRedisClient().ping();
  },
  pipeline(): RedisPipelineCompat {
    return new RedisPipelineCompat(requireRedisClient().pipeline());
  },
};

export async function expire(key: string, seconds: number) {
  return redis.expire(key, seconds);
}
