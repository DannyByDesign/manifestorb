#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = process.cwd();
const files = [
  "src/server/features/ai/runtime/turn-contract.ts",
  "src/server/features/ai/runtime/turn-planner.ts",
  "src/server/features/ai/runtime/context/retrieval-broker.ts",
  "src/server/features/ai/runtime/pending-decision-extractor.ts",
  "src/server/features/ai/message-processor.ts",
  "src/server/features/policy-plane/canonical-schema.ts",
  "src/server/features/policy-plane/compiler.ts",
  "src/server/features/policy-plane/pdp.ts",
  "src/server/features/policy-plane/automation-executor.ts",
  "src/server/features/ai/tools/policy/policy-matcher.ts",
];

function scriptKindForFile(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

const violations = [];
for (const relativeFile of files) {
  const fullPath = path.join(repoRoot, relativeFile);
  if (!fs.existsSync(fullPath)) continue;
  const source = fs.readFileSync(fullPath, "utf8");
  const sourceFile = ts.createSourceFile(
    fullPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(fullPath),
  );

  function visit(node) {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      violations.push(`${relativeFile}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      node.expression &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "RegExp"
    ) {
      violations.push(`${relativeFile}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

if (violations.length > 0) {
  console.error("Regex usage detected in regex-prohibited orchestration files:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("No regex usage detected in protected orchestration files.");
