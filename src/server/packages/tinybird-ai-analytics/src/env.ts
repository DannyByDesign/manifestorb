import { z } from "zod";

const envSchema = z.object({
    TINYBIRD_TOKEN: z.string().optional(),
    TINYBIRD_BASE_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);
