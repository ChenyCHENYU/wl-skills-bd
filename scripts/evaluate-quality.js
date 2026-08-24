#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runBeRules } = require("../lib/be-rules");
const { clearScanContextCache } = require("../lib/scan-context");
const sourceIndex = require("../lib/source-index");
const { applyResultBudget, clearResultStore } = require("../mcp/result-budget");

const ROOT = path.resolve(__dirname, "..");
const corpus = require(path.join(ROOT, "tests", "fixtures", "be-rule-accuracy.json"));
const budgets = require(path.join(ROOT, "tests", "fixtures", "quality-budgets.json"));

function writeFixture(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)] || 0;
}

function evaluateAccuracy() {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const failures = [];
  for (const testCase of corpus) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-accuracy-"));
    try {
      writeFixture(root, testCase.files);
      const result = runBeRules(root, { rules: testCase.rules });
      const actual = new Set(result.issues.filter((item) => /^B\d+$/.test(item.rule)).map((item) => item.rule));
      const expected = new Set(testCase.expectedRules);
      for (const rule of actual) {
        if (expected.has(rule)) truePositive += 1;
        else { falsePositive += 1; failures.push(`${testCase.id}: unexpected ${rule}`); }
      }
      for (const rule of expected) {
        if (!actual.has(rule)) { falseNegative += 1; failures.push(`${testCase.id}: missing ${rule}`); }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  return { cases: corpus.length, truePositive, falsePositive, falseNegative, precision, recall, failures };
}

function evaluatePerformance() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-performance-"));
  try {
    const files = {};
    for (let index = 0; index < 120; index += 1) {
      files[`src/main/java/demo/Service${index}.java`] = index === 0
        ? "class Service0 { RedisTemplate redis; void put(String k,String v){ redis.opsForValue().set(k,v); } }\n"
        : `class Service${index} { void read() {} }\n`;
      files[`src/main/resources/mapper/Mapper${index}.xml`] = `<mapper namespace=\"Mapper${index}\"><select id=\"read\">SELECT ID FROM DEMO WHERE COMPANY_ID=#{companyId}</select></mapper>\n`;
    }
    writeFixture(root, files);
    clearScanContextCache();
    runBeRules(root, { rules: ["B13"] });
    const scopedTimes = [];
    const fullTimes = [];
    let scoped;
    let full;
    for (let index = 0; index < 12; index += 1) {
      let started = process.hrtime.bigint();
      scoped = runBeRules(root, { rules: ["B13"] });
      scopedTimes.push(Number(process.hrtime.bigint() - started) / 1e6);
      started = process.hrtime.bigint();
      full = runBeRules(root);
      fullTimes.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    return {
      fixtureFiles: Object.keys(files).length,
      scopedP95Ms: percentile(scopedTimes, 0.95),
      fullP95Ms: percentile(fullTimes, 0.95),
      scopedGroups: scoped.execution.executedGroups.length,
      fullGroups: full.execution.executedGroups.length,
      scopedGroupRatio: scoped.execution.executedGroups.length / full.execution.executedGroups.length,
      scopedLoadedFiles: scoped.execution.scan.loadedFiles,
      fullLoadedFiles: full.execution.scan.loadedFiles,
      contentCacheHits: scoped.execution.scan.contentCacheHits,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function evaluateSourceCache() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-cache-eval-"));
  try {
    fs.mkdirSync(path.join(root, ".wl-skills-bd"), { recursive: true });
    writeFixture(root, {
      "contracts/demo.json": JSON.stringify({ entity: { table: "demo" }, fields: [{ column: "id" }] }),
    });
    sourceIndex.clearSourceIndexMemoryCache();
    const cold = sourceIndex.buildSourceIndex(root);
    const warm = sourceIndex.buildSourceIndex(root);
    sourceIndex.clearSourceIndexMemoryCache();
    const persistent = sourceIndex.buildSourceIndex(root);
    return { cold: cold.cache.level, warm: warm.cache.level, persistent: persistent.cache.level };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function evaluateMcpBudget() {
  clearResultStore();
  const result = applyResultBudget("quality-eval", {
    mode: "summary",
    maxItems: 10,
    maxBytes: budgets.mcp.maxBytes,
  }, {
    text: "detail\n".repeat(10000),
    structuredContent: { ok: true, issues: Array.from({ length: 1000 }, (_, id) => ({ id, message: "x".repeat(200) })) },
  });
  const bytes = Buffer.byteLength(JSON.stringify({ text: result.text, structuredContent: result.structuredContent }), "utf8");
  return {
    bytes,
    estimatedTokens: result.structuredContent.response.estimatedTokens,
    truncated: result.structuredContent.response.truncated,
    cursor: Boolean(result.structuredContent.response.nextCursor),
  };
}

const report = {
  schemaVersion: 1,
  accuracy: evaluateAccuracy(),
  performance: evaluatePerformance(),
  sourceCache: evaluateSourceCache(),
  mcp: evaluateMcpBudget(),
};

assert.ok(report.accuracy.precision >= budgets.accuracy.minimumPrecision, `precision ${report.accuracy.precision} 低于 ${budgets.accuracy.minimumPrecision}: ${report.accuracy.failures.join("; ")}`);
assert.ok(report.accuracy.recall >= budgets.accuracy.minimumRecall, `recall ${report.accuracy.recall} 低于 ${budgets.accuracy.minimumRecall}: ${report.accuracy.failures.join("; ")}`);
assert.ok(report.performance.scopedP95Ms <= budgets.performance.scopedP95Ms, `scoped P95 ${report.performance.scopedP95Ms}ms 超预算`);
assert.ok(report.performance.fullP95Ms <= budgets.performance.fullP95Ms, `full P95 ${report.performance.fullP95Ms}ms 超预算`);
assert.ok(report.performance.scopedGroupRatio <= budgets.performance.maximumScopedGroupRatio, `规则短路比例 ${report.performance.scopedGroupRatio} 超预算`);
assert.strictEqual(report.sourceCache.warm, "memory");
assert.strictEqual(report.sourceCache.persistent, "persistent");
assert.ok(report.mcp.bytes <= budgets.mcp.maxBytes, `MCP ${report.mcp.bytes} bytes 超预算`);
assert.ok(report.mcp.estimatedTokens <= budgets.mcp.maximumEstimatedTokens, `MCP token 估算 ${report.mcp.estimatedTokens} 超预算`);
assert.strictEqual(report.mcp.cursor, true);

if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  console.log(`✅ quality eval：precision=${report.accuracy.precision.toFixed(3)} recall=${report.accuracy.recall.toFixed(3)}；scoped/full P95=${report.performance.scopedP95Ms.toFixed(1)}/${report.performance.fullP95Ms.toFixed(1)}ms；MCP≈${report.mcp.estimatedTokens} tokens`);
}
