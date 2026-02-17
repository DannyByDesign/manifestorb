import fs from "fs/promises";
import path from "path";
import {
  calibrateRankingWeights,
  type RankingEvalCase,
} from "@/server/features/search/unified/calibration";

function parseArg(name: string): string | undefined {
  const entry = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : undefined;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asEvalCases(rows: unknown[]): RankingEvalCase[] {
  const out: RankingEvalCase[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const docsRaw = Array.isArray(item.docs) ? item.docs : [];
    const docs = docsRaw
      .filter((doc): doc is Record<string, unknown> => Boolean(doc && typeof doc === "object"))
      .map((doc, idx) => ({
        id: typeof doc.id === "string" && doc.id.length > 0 ? doc.id : `doc-${idx + 1}`,
        lexical: toNumber(doc.lexical),
        semantic:
          doc.semantic === undefined || doc.semantic === null
            ? undefined
            : toNumber(doc.semantic),
        freshness: toNumber(doc.freshness),
        authority: toNumber(doc.authority),
        intentSurface: toNumber(doc.intentSurface),
        behavior: toNumber(doc.behavior),
        graphProximity: toNumber(doc.graphProximity),
        relevance: toNumber(doc.relevance),
      }))
      .filter((doc) => Number.isFinite(doc.relevance));

    if (docs.length === 0) continue;
    out.push({
      id:
        typeof item.id === "string" && item.id.length > 0
          ? item.id
          : `case-${out.length + 1}`,
      query: typeof item.query === "string" ? item.query : "",
      docs,
    });
  }
  return out;
}

async function loadEvalCases(filePath: string): Promise<RankingEvalCase[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown[];
    return asEvalCases(parsed);
  }

  const lines = trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const parsedLines = lines.map((line) => JSON.parse(line) as unknown);
  return asEvalCases(parsedLines);
}

async function main() {
  const inputPath = parseArg("--input") ??
    path.join(process.cwd(), "tests/evals/search-ranking-corpus.jsonl");
  const outputPath = parseArg("--output") ??
    path.join(process.cwd(), "tests/evals/search-ranking-weights.latest.json");

  const evalCases = await loadEvalCases(inputPath);
  if (evalCases.length === 0) {
    console.error("No ranking eval cases found", { inputPath });
    process.exitCode = 1;
    return;
  }

  const calibrated = calibrateRankingWeights({ evalCases });
  const payload = {
    generatedAt: new Date().toISOString(),
    inputPath,
    cases: evalCases.length,
    baseline: calibrated.baseline,
    optimized: calibrated.optimized,
    weights: calibrated.weights,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(payload, null, 2));
  console.log("");
  console.log(
    `Use runtime weights env: UNIFIED_SEARCH_RANKING_WEIGHTS_JSON='${JSON.stringify(calibrated.weights)}'`,
  );
}

main().catch((error) => {
  console.error("search_ranking_calibration_failed", error);
  process.exitCode = 1;
});
