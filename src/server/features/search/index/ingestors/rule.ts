import type { CanonicalRule } from "@/server/features/policy-plane/canonical-schema";
import { SearchIndexQueue } from "@/server/features/search/index/queue";
import type { Logger } from "@/server/lib/logger";
import type { SearchDocumentIdentity, SearchIndexedDocument } from "@/server/features/search/index/types";
import {
  upsertSearchAlias,
  upsertSearchEntity,
} from "@/server/features/search/index/repository";

function toRuleBody(rule: CanonicalRule): string {
  const actions = rule.actionPlan?.actions?.map((action) => action.actionType).join(", ") ?? "";
  const conditions = rule.match.conditions
    .map((condition) => `${condition.field} ${condition.op} ${JSON.stringify(condition.value)}`)
    .join("\n");

  return [
    rule.name,
    rule.description,
    rule.source.sourceNl,
    `type=${rule.type}`,
    `resource=${rule.match.resource}`,
    `operation=${rule.match.operation ?? ""}`,
    actions ? `actions=${actions}` : "",
    conditions,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

export async function enqueueRuleDocumentForIndexing(params: {
  userId: string;
  emailAccountId?: string;
  rule: CanonicalRule;
  logger: Logger;
}) {
  const payload: SearchIndexedDocument = {
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    connector: "rule",
    sourceType: "canonical_rule",
    sourceId: params.rule.id,
    title: params.rule.name ?? `${params.rule.type} rule`,
    snippet: params.rule.description ?? params.rule.source.sourceNl ?? "",
    bodyText: toRuleBody(params.rule),
    occurredAt: undefined,
    updatedSourceAt: new Date().toISOString(),
    freshnessScore: 0.5,
    authorityScore: params.rule.priority / 100,
    metadata: {
      ruleType: params.rule.type,
      enabled: params.rule.enabled,
      priority: params.rule.priority,
      resource: params.rule.match.resource,
      operation: params.rule.match.operation ?? null,
      sourceMode: params.rule.source.mode,
    },
  };

  try {
    await SearchIndexQueue.enqueueUpsert(payload);
    const canonicalRuleRef = params.rule.id;
    void upsertSearchEntity({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      entityType: "rule",
      canonicalValue: canonicalRuleRef,
      displayValue: params.rule.name ?? params.rule.id,
      confidence: 0.95,
      metadata: {
        source: "rule",
        ruleType: params.rule.type,
      },
    });
    if (params.rule.name && params.rule.name.trim().length > 0) {
      void upsertSearchAlias({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        entityType: "rule",
        canonicalValue: canonicalRuleRef,
        aliasValue: params.rule.name,
        confidence: 0.85,
        metadata: {
          source: "rule",
        },
      });
    }
  } catch (error) {
    params.logger.warn("Failed to enqueue rule for indexing", {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      ruleId: params.rule.id,
      error,
    });
  }
}

export async function enqueueRuleDeleteForIndexing(params: {
  identity: SearchDocumentIdentity;
  logger: Logger;
}) {
  try {
    await SearchIndexQueue.enqueueDelete(params.identity);
  } catch (error) {
    params.logger.warn("Failed to enqueue rule deletion for indexing", {
      identity: params.identity,
      error,
    });
  }
}
