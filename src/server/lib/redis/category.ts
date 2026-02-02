import { z } from "zod";
import { redis } from "@/server/lib/redis";

// TTL for category cache: 30 days
const CATEGORY_TTL_SECONDS = 30 * 24 * 60 * 60;

const categorySchema = z.object({
  category: z.string(),
});
export type RedisCategory = z.infer<typeof categorySchema>;

function getKey({ emailAccountId }: { emailAccountId: string }) {
  return `categories:${emailAccountId}`;
}
function getCategoryKey({ threadId }: { threadId: string }) {
  return `category:${threadId}`;
}

export async function getCategory({
  emailAccountId,
  threadId,
}: {
  emailAccountId: string;
  threadId: string;
}) {
  const key = getKey({ emailAccountId });
  const categoryKey = getCategoryKey({ threadId });
  const category = await redis.hget<RedisCategory>(key, categoryKey);
  if (!category) return null;
  return { ...category, id: categoryKey };
}

export async function saveCategory({
  emailAccountId,
  threadId,
  category,
}: {
  emailAccountId: string;
  threadId: string;
  category: RedisCategory;
}) {
  const key = getKey({ emailAccountId });
  const categoryKey = getCategoryKey({ threadId });
  await redis.hset(key, { [categoryKey]: category });
  // Refresh TTL on each write to prevent stale data accumulation
  await redis.expire(key, CATEGORY_TTL_SECONDS);
}

export async function deleteCategory({
  emailAccountId,
  threadId,
}: {
  emailAccountId: string;
  threadId: string;
}) {
  const key = getKey({ emailAccountId });
  const categoryKey = getCategoryKey({ threadId });
  return redis.hdel(key, categoryKey);
}

export async function deleteCategories({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const key = getKey({ emailAccountId });
  return redis.del(key);
}
