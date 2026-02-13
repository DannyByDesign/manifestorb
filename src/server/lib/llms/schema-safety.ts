import type { ZodTypeAny } from "zod";

export interface ProviderSchemaRegistration {
  id: string;
  owner: string;
  route: "preflight" | "router" | "parser" | "slots" | "planner";
  label: string;
  schema: ZodTypeAny;
}

type SchemaViolation = {
  path: string;
  message: string;
};

type DefLike = Record<string, unknown> & {
  type?: unknown;
};

const providerSchemaRegistry = new Map<string, Omit<ProviderSchemaRegistration, "schema">>();

const SAFE_PRIMITIVE_SCHEMA_TYPES = new Set<string>([
  "string",
  "number",
  "bigint",
  "boolean",
  "date",
  "enum",
  "literal",
  "null",
  "undefined",
  "void",
  "nan",
  "file",
]);

function getDef(schema: ZodTypeAny): DefLike {
  const def = (schema as unknown as { _def?: unknown; def?: unknown })._def;
  if (def && typeof def === "object") return def as DefLike;
  const alt = (schema as unknown as { def?: unknown }).def;
  if (alt && typeof alt === "object") return alt as DefLike;
  return {};
}

function getTypeName(schema: ZodTypeAny): string {
  const def = getDef(schema);
  return typeof def.type === "string" ? def.type : "unknown";
}

function getObjectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  const def = getDef(schema);
  const rawShape = def.shape;
  if (!rawShape) return {};
  if (typeof rawShape === "function") {
    try {
      const computed = rawShape();
      if (computed && typeof computed === "object") {
        return computed as Record<string, ZodTypeAny>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (rawShape && typeof rawShape === "object") {
    return rawShape as Record<string, ZodTypeAny>;
  }
  return {};
}

function pushViolation(
  violations: SchemaViolation[],
  path: string,
  message: string,
): void {
  violations.push({ path, message });
}

function asSchema(value: unknown): ZodTypeAny | null {
  if (!value || typeof value !== "object") return null;
  return value as ZodTypeAny;
}

function walkSchema(
  schema: ZodTypeAny,
  path: string,
  violations: SchemaViolation[],
  inUnionBranch = false,
): void {
  const typeName = getTypeName(schema);
  const def = getDef(schema);

  if (typeName === "unknown" || typeName === "any") {
    pushViolation(
      violations,
      path,
      "ZodAny/ZodUnknown is not allowed in provider-facing structured output schemas.",
    );
    return;
  }

  if (typeName === "transform" || typeName === "pipe") {
    pushViolation(
      violations,
      path,
      "Transforms/effects are not allowed in provider-facing structured output schemas.",
    );
    return;
  }

  if (SAFE_PRIMITIVE_SCHEMA_TYPES.has(typeName)) {
    return;
  }

  if (
    typeName === "optional" ||
    typeName === "nullable" ||
    typeName === "default" ||
    typeName === "prefault" ||
    typeName === "readonly" ||
    typeName === "catch" ||
    typeName === "nonoptional"
  ) {
    const inner = asSchema(def.innerType);
    if (inner) {
      walkSchema(inner, `${path}.inner`, violations, inUnionBranch);
    }
    return;
  }

  if (typeName === "array") {
    const item = asSchema(def.element);
    if (item) {
      walkSchema(item, `${path}[]`, violations, inUnionBranch);
    }
    return;
  }

  if (typeName === "tuple") {
    const items = Array.isArray(def.items)
      ? (def.items as unknown[])
      : [];
    items.forEach((item, idx) => {
      const schemaItem = asSchema(item);
      if (schemaItem) {
        walkSchema(schemaItem, `${path}[${idx}]`, violations, inUnionBranch);
      }
    });
    const rest = asSchema(def.rest);
    if (rest) {
      walkSchema(rest, `${path}[rest]`, violations, inUnionBranch);
    }
    return;
  }

  if (typeName === "object") {
    const shape = getObjectShape(schema);
    const keys = Object.keys(shape);
    if (inUnionBranch && keys.length === 0) {
      pushViolation(
        violations,
        path,
        "Object branches inside unions must have non-empty explicit properties.",
      );
      return;
    }
    for (const key of keys) {
      walkSchema(shape[key]!, `${path}.${key}`, violations, inUnionBranch);
    }
    const catchall = asSchema(def.catchall);
    if (catchall && getTypeName(catchall) !== "never") {
      pushViolation(
        violations,
        `${path}.*`,
        "Catch-all object keys are not allowed in provider-facing structured output schemas.",
      );
    }
    return;
  }

  if (typeName === "record") {
    const valueType = asSchema(def.valueType);
    const valueTypeName = valueType ? getTypeName(valueType) : "unknown";
    if (!valueType || valueTypeName === "any" || valueTypeName === "unknown") {
      pushViolation(
        violations,
        path,
        "Open-ended record values are not allowed in provider-facing structured output schemas.",
      );
      return;
    }
    walkSchema(valueType, `${path}.*`, violations, inUnionBranch);
    return;
  }

  if (typeName === "union") {
    const options = Array.isArray(def.options)
      ? (def.options as unknown[])
      : [];
    options.forEach((option, idx) => {
      const optionSchema = asSchema(option);
      if (optionSchema) {
        walkSchema(optionSchema, `${path}.union[${idx}]`, violations, true);
      }
    });
    return;
  }

  if (typeName === "discriminatedUnion") {
    const options = Array.isArray(def.options)
      ? (def.options as unknown[])
      : [];
    options.forEach((option, idx) => {
      const optionSchema = asSchema(option);
      if (optionSchema) {
        walkSchema(optionSchema, `${path}.du[${idx}]`, violations, true);
      }
    });
    return;
  }

  if (typeName === "intersection") {
    const left = asSchema(def.left);
    const right = asSchema(def.right);
    if (left) walkSchema(left, `${path}.left`, violations, inUnionBranch);
    if (right) walkSchema(right, `${path}.right`, violations, inUnionBranch);
    return;
  }

  if (typeName === "lazy") {
    const getter = def.getter;
    if (typeof getter === "function") {
      try {
        const lazySchema = asSchema(getter());
        if (lazySchema) {
          walkSchema(lazySchema, `${path}.lazy`, violations, inUnionBranch);
        }
      } catch {
        pushViolation(
          violations,
          `${path}.lazy`,
          "Failed to evaluate lazy schema.",
        );
      }
    }
    return;
  }

  if (typeName === "never") {
    return;
  }

  // Unknown schema type. Flag it explicitly so we do not silently allow unsafe constructs.
  pushViolation(
    violations,
    path,
    `Unsupported schema type \"${typeName}\" in provider-facing structured output schema.`,
  );
}

export function assertProviderFacingSchemaSafety(params: {
  schema: ZodTypeAny;
  label: string;
}): void {
  const violations: SchemaViolation[] = [];
  walkSchema(params.schema, "$", violations, false);
  if (violations.length === 0) return;

  const compact = violations
    .slice(0, 8)
    .map((v) => `${v.path}: ${v.message}`)
    .join(" | ");
  throw new Error(`provider_schema_unsafe:${params.label}:${compact}`);
}

export function registerProviderSchema(
  registration: ProviderSchemaRegistration,
): void {
  assertProviderFacingSchemaSafety({
    schema: registration.schema,
    label: registration.id,
  });

  const existing = providerSchemaRegistry.get(registration.id);
  const meta = {
    id: registration.id,
    owner: registration.owner,
    route: registration.route,
    label: registration.label,
  };

  if (!existing) {
    providerSchemaRegistry.set(registration.id, meta);
    return;
  }

  if (
    existing.owner !== meta.owner ||
    existing.route !== meta.route ||
    existing.label !== meta.label
  ) {
    throw new Error(
      `provider_schema_registry_conflict:${registration.id}:` +
        `existing=${JSON.stringify(existing)}:incoming=${JSON.stringify(meta)}`,
    );
  }
}

export function validateProviderSchemaRegistry(params: {
  expectedSchemaIds: string[];
}): void {
  const missing = params.expectedSchemaIds.filter(
    (id) => !providerSchemaRegistry.has(id),
  );

  if (missing.length > 0) {
    throw new Error(
      `provider_schema_registry_missing:${missing.join(",")}`,
    );
  }
}

export function getProviderSchemaRegistrySnapshot(): Array<
  Omit<ProviderSchemaRegistration, "schema">
> {
  return Array.from(providerSchemaRegistry.values());
}
