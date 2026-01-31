import { Tinybird } from "@chronark/zod-bird";
import { env } from "./env";

let tb: Tinybird;

export const getTinybird = () => {
  if (!env.TINYBIRD_TOKEN) return;

  if (!tb) {
    tb = new Tinybird({
      token: env.TINYBIRD_TOKEN,
      baseUrl: env.TINYBIRD_BASE_URL,
    });
  }

  return tb;
};
