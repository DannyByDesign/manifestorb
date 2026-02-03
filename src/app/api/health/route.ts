import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { env } from "@/env";
import { redis } from "@/server/lib/redis";

export const GET = async () => {
  let db = "ok";
  let cache = "not_configured";
  let qstash = env.QSTASH_TOKEN ? "configured" : "missing";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }

  if (env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN) {
    try {
      await redis.ping();
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
