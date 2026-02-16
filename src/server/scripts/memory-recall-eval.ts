import fs from "fs/promises";
import path from "path";
import prisma from "@/server/db/client";
import { orchestrateMemoryRetrieval } from "@/server/features/memory/retrieval/orchestrator";

type EvalCase = {
  id: string;
  query: string;
  expectedAny: string[];
  intent: "person_recall" | "meeting_recall" | "commitment_recall" | "general_recall";
};

function parseArg(name: string): string | undefined {
  const entry = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : undefined;
}

function hasCiFlag(): boolean {
  return process.argv.includes("--ci");
}

function scoreCase(params: {
  expectedAny: string[];
  snippets: string[];
  predictedIntent: string;
  expectedIntent: string;
}) {
  const lowerSnippets = params.snippets.map((snippet) => snippet.toLowerCase());
  const matchedExpected = params.expectedAny.filter((expected) =>
    lowerSnippets.some((snippet) => snippet.includes(expected.toLowerCase())),
  );

  const recall = params.expectedAny.length > 0 ? matchedExpected.length / params.expectedAny.length : 1;
  const precision = params.snippets.length > 0 ? matchedExpected.length / params.snippets.length : 0;
  const intentCorrect = params.predictedIntent === params.expectedIntent ? 1 : 0;

  return {
    recall,
    precision,
    intentCorrect,
    matchedExpected,
  };
}

async function main() {
  const corpusPath =
    parseArg("--corpus") ??
    path.join(process.cwd(), "tests/evals/memory-recall-corpus.json");
  const userId =
    parseArg("--user") ??
    process.env.MEMORY_EVAL_USER_ID;

  if (!userId) {
    console.error("Missing user id. Provide --user=<userId> or MEMORY_EVAL_USER_ID.");
    process.exitCode = 1;
    return;
  }

  const corpusRaw = await fs.readFile(corpusPath, "utf8");
  const corpus = JSON.parse(corpusRaw) as EvalCase[];

  const results: Array<{
    id: string;
    precision: number;
    recall: number;
    intentCorrect: number;
    matchedExpected: string[];
  }> = [];

  for (const testCase of corpus) {
    const retrieval = await orchestrateMemoryRetrieval({
      userId,
      query: testCase.query,
      limit: 8,
      surface: "eval",
    });

    const snippets = retrieval.citations.map((citation) => citation.snippet);
    const scoring = scoreCase({
      expectedAny: testCase.expectedAny,
      snippets,
      predictedIntent: retrieval.intent,
      expectedIntent: testCase.intent,
    });

    results.push({
      id: testCase.id,
      precision: scoring.precision,
      recall: scoring.recall,
      intentCorrect: scoring.intentCorrect,
      matchedExpected: scoring.matchedExpected,
    });
  }

  const averagePrecision = results.reduce((sum, item) => sum + item.precision, 0) / Math.max(results.length, 1);
  const averageRecall = results.reduce((sum, item) => sum + item.recall, 0) / Math.max(results.length, 1);
  const intentAccuracy = results.reduce((sum, item) => sum + item.intentCorrect, 0) / Math.max(results.length, 1);

  const summary = {
    cases: results.length,
    averagePrecision,
    averageRecall,
    intentAccuracy,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (hasCiFlag()) {
    const minPrecision = Number.parseFloat(process.env.MEMORY_EVAL_MIN_PRECISION ?? "0.2");
    const minRecall = Number.parseFloat(process.env.MEMORY_EVAL_MIN_RECALL ?? "0.2");
    const minIntentAccuracy = Number.parseFloat(process.env.MEMORY_EVAL_MIN_INTENT_ACCURACY ?? "0.5");

    if (
      averagePrecision < minPrecision ||
      averageRecall < minRecall ||
      intentAccuracy < minIntentAccuracy
    ) {
      console.error("Memory eval gate failed", {
        averagePrecision,
        averageRecall,
        intentAccuracy,
        minPrecision,
        minRecall,
        minIntentAccuracy,
      });
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error("memory_recall_eval_failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
