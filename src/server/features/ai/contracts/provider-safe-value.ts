import { z } from "zod";

export const providerValueDtoSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("string"),
      value: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("number"),
      value: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("boolean"),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("string_list"),
      value: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("json"),
      value: z.string(),
    })
    .strict(),
]);

export type ProviderValueDto = z.infer<typeof providerValueDtoSchema>;

export function decodeProviderValueDto(params: {
  value: ProviderValueDto;
  parseJson: boolean;
}): unknown {
  const { value, parseJson } = params;
  switch (value.kind) {
    case "string":
    case "number":
    case "boolean":
    case "string_list":
      return value.value;
    case "json":
      if (!parseJson) return value.value;
      try {
        return JSON.parse(value.value);
      } catch {
        return value.value;
      }
    default: {
      const neverValue: never = value;
      return neverValue;
    }
  }
}
