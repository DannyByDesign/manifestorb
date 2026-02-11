import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { env } from "@/env";
import { redis } from "@/server/lib/redis";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), ms);
    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export const GET = async () => {
  let db = "ok";
  let cache = "not_configured";
  const qstash = env.QSTASH_TOKEN ? "configured" : "missing";

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 1500);
  } catch {
    db = "error";
  }

  if (env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN) {
    try {
      await withTimeout(redis.ping(), 1000);
      cache = "ok";
    } catch {
      cache = "error";
    }
  }

  return NextResponse.json({
    status: "ok",
    db,
    cache,
    qstash,
  });
};
