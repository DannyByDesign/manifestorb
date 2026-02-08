import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  TAXONOMY_TARGET_FULL,
  buildTaxonomyPatterns,
  evaluateTaxonomy,
  hasMinimumCoverage,
  type PatternEvaluation,
} from "@/server/features/ai/evals/taxonomy";

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  const minArg = argv.find((arg) => arg.startsWith("--min-full="));
  const minFull = minArg ? Number(minArg.split("=")[1]) : TAXONOMY_TARGET_FULL;
  return {
    ci: args.has("--ci"),
    writeReport: args.has("--write-report"),
    minFull: Number.isFinite(minFull) ? minFull : TAXONOMY_TARGET_FULL,
  };
}

function toPercent(part: number, total: number): string {
  if (total === 0) return "0.00%";
  return `${((part / total) * 100).toFixed(2)}%`;
}

function buildTop20Markdown(results: PatternEvaluation[]): string {
  const failing = results
    .filter((r) => r.status !== "full")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "unsupported" ? -1 : 1;
      return a.pattern.id.localeCompare(b.pattern.id);
    })
    .slice(0, 20);

  const lines = [
    "# Top 20 Critical Taxonomy Gaps",
    "",
    "| Pattern ID | Status | Category | Request | Gap |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const row of failing) {
    const gap = row.blockers.length > 0 ? row.blockers.join(", ") : row.partials.join(", ");
    lines.push(
      `| ${row.pattern.id} | ${row.status.toUpperCase()} | ${row.pattern.category} | ${row.pattern.request.replace(/\|/g, "\\|")} | ${gap} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

async function maybeWriteReports(payload: {
  summary: Record<string, unknown>;
  patterns: ReturnType<typeof buildTaxonomyPatterns>;
  top20Markdown: string;
}) {
  const reportDir = resolve(process.cwd(), "docs", "reports", "taxonomy");
  await mkdir(reportDir, { recursive: true });

  const latestPath = resolve(reportDir, "coverage-latest.json");
  const historyPath = resolve(reportDir, "coverage-history.jsonl");
  const patternsPath = resolve(reportDir, "patterns-latest.json");
  const top20Path = resolve(reportDir, "top-20-critical-issues.md");

  await writeFile(latestPath, JSON.stringify(payload.summary, null, 2));
  await appendFile(historyPath, `${JSON.stringify(payload.summary)}\n`);
  await writeFile(patternsPath, JSON.stringify(payload.patterns, null, 2));
  await writeFile(top20Path, payload.top20Markdown);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const patterns = buildTaxonomyPatterns();
  const evaluation = evaluateTaxonomy(patterns);

  const summary = {
    generatedAt: new Date().toISOString(),
    thresholdFull: options.minFull,
    total: evaluation.total,
    full: evaluation.full,
    partial: evaluation.partial,
    unsupported: evaluation.unsupported,
    fullCoverage: toPercent(evaluation.full, evaluation.total),
    partialCoverage: toPercent(evaluation.partial, evaluation.total),
    unsupportedCoverage: toPercent(evaluation.unsupported, evaluation.total),
    byCategory: evaluation.byCategory,
    byRequirementGap: evaluation.byRequirementGap,
    topFailingPatterns: evaluation.results
      .filter((r) => r.status !== "full")
      .slice(0, 20)
      .map((r) => ({
        id: r.pattern.id,
        status: r.status,
        category: r.pattern.category,
        request: r.pattern.request,
        blockers: r.blockers,
        partials: r.partials,
      })),
  };

  if (options.writeReport) {
    await maybeWriteReports({
      summary,
      patterns,
      top20Markdown: buildTop20Markdown(evaluation.results),
    });
  }

  const pass = hasMinimumCoverage(evaluation, options.minFull);
  console.log(
    JSON.stringify(
      {
        status: pass ? "pass" : "fail",
        thresholdFull: options.minFull,
        total: evaluation.total,
        full: evaluation.full,
        partial: evaluation.partial,
        unsupported: evaluation.unsupported,
      },
      null,
      2
    )
  );

  if (!pass || (options.ci && evaluation.unsupported > 0 && evaluation.full < options.minFull)) {
    process.exitCode = 1;
  }
}

void main();
