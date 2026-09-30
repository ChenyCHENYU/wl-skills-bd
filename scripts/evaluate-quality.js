#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runBeRules } = require("../lib/be-rules");
const { clearScanContextCache } = require("../lib/scan-context");
const sourceIndex = require("../lib/source-index");
const { catalogSlice, summarizeCatalog } = require("../lib/project-catalog");
const { compactExecution, compactModuleEvidence } = require("../lib/review");
const { applyResultBudget, clearResultStore } = require("../mcp/result-budget");

const ROOT = path.resolve(__dirname, "..");
const corpus = [
  ...require(path.join(ROOT, "tests", "fixtures", "be-rule-accuracy.json")),
  ...require(path.join(ROOT, "tests", "fixtures", "be-rule-accuracy-extra.js")),
  ...require(path.join(ROOT, "tests", "fixtures", "be-rule-accuracy-negatives.js")),
];
const budgets = require(path.join(ROOT, "tests", "fixtures", "quality-budgets.json"));
const ruleIds = require(path.join(ROOT, "files", ".wl-skills-bd", "capabilities.json")).backendRules.ids;

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
  let exactCases = 0;
  const failures = [];
  for (const testCase of corpus) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-accuracy-"));
    try {
      writeFixture(root, testCase.files);
      const result = runBeRules(root, { rules: testCase.rules });
      const actualFindings = result.issues.filter((item) => /^B\d+$/.test(item.rule));
      const actual = new Set(actualFindings.map((item) => item.rule));
      const expected = new Set(testCase.expectedRules);
      if (Array.isArray(testCase.expectedFindings)) {
        exactCases += 1;
        const project = (item) => ({ rule: item.rule, file: item.file, line: item.line, severity: item.severity });
        const sort = (items) => items.map(project).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
        if (JSON.stringify(sort(actualFindings)) !== JSON.stringify(sort(testCase.expectedFindings))) {
          failures.push(`${testCase.id}: finding location/severity mismatch`);
          falsePositive += 1;
          falseNegative += 1;
        }
      }
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
  const coveredRuleIds = [...new Set(corpus.flatMap((testCase) => testCase.rules))].sort();
  const positiveRules = new Set(corpus.filter((item) => item.expectedRules.length > 0).flatMap((item) => item.expectedRules));
  const negativeRules = new Set(corpus.filter((item) => item.expectedRules.length === 0).flatMap((item) => item.rules));
  return { cases: corpus.length, coveredRuleIds, coveredRules: coveredRuleIds.length,
    positiveRules: positiveRules.size, negativeRules: negativeRules.size, exactCases,
    totalRules: ruleIds.length, truePositive, falsePositive, falseNegative, precision, recall, failures };
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
    const scopedCold = runBeRules(root, { rules: ["B13"] });
    const scopedWarm = runBeRules(root, { rules: ["B13"] });
    clearScanContextCache();
    const fullCold = runBeRules(root);
    const fullWarm = runBeRules(root);
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
      scopedColdMisses: scopedCold.execution.scan.contentCacheMisses,
      scopedWarmHits: scopedWarm.execution.scan.contentCacheHits,
      fullColdMisses: fullCold.execution.scan.contentCacheMisses,
      fullWarmHits: fullWarm.execution.scan.contentCacheHits,
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

function evaluateCatalogBudget() {
  const resources = Array.from({ length: 1000 }, (_, index) => ({
    contractId: `resource-${index}`,
    contractKind: index % 10 === 0 ? "integration-projection" : "schema-mirror",
    description: "x".repeat(100),
    entity: `Entity${index}`,
  }));
  const catalog = {
    schemaVersion: 1,
    kind: "wl-module-catalog",
    project: { id: "quality-eval" },
    module: { id: "quality" },
    sourceHash: "a".repeat(64),
    catalogHash: "b".repeat(64),
    resources,
    services: [],
    apis: [],
    databases: [],
    relations: [],
    sourceEvidence: Array.from({ length: 1000 }, (_, index) => ({ rel: `src/File${index}.java`, bytes: index + 1 })),
    diagnostics: { errors: [], warnings: [] },
  };
  const fullBytes = Buffer.byteLength(JSON.stringify(catalog), "utf8");
  const summaryBytes = Buffer.byteLength(JSON.stringify(summarizeCatalog(catalog)), "utf8");
  const page = catalogSlice(catalog, "resources");
  return {
    fullBytes,
    summaryBytes,
    summaryEstimatedTokens: Math.ceil(summaryBytes / 4),
    summaryToFullRatio: summaryBytes / fullBytes,
    defaultPageItems: page.items.length,
    totalItems: page.total,
    nextCursor: page.nextCursor,
  };
}

function evaluateReviewBudget() {
  const rules = ruleIds;
  const modules = Array.from({ length: 100 }, (_, index) => ({
    id: `module-${index}`,
    root: `services/module-${index}`,
    stats: { error: index % 17 === 0 ? 1 : 0, warn: 0, info: 0, total: index % 17 === 0 ? 1 : 0, suppressed: 0, byRule: index % 17 === 0 ? { B26: 1 } : {} },
    execution: {
      requestedRules: rules,
      executedRules: rules,
      executedGroups: ["controller", "mapperSql", "service"],
      unknownRules: [],
      scan: { discoveredFiles: 100, loadedFiles: 50, loadedBytes: 100000, oversizedFiles: 0, contentCacheHits: 0, contentCacheMisses: 50 },
    },
  }));
  const full = { ruleCoverage: { status: "complete", evaluatedRules: rules, skippedRules: [] }, modules, execution: modules[0].execution };
  const summary = {
    ruleCoverage: full.ruleCoverage,
    modules: compactModuleEvidence(modules, budgets.review.defaultModuleItems),
    execution: compactExecution(full.execution),
  };
  const fullBytes = Buffer.byteLength(JSON.stringify(full), "utf8");
  const summaryBytes = Buffer.byteLength(JSON.stringify(summary), "utf8");
  return {
    fullBytes,
    summaryBytes,
    estimatedTokens: Math.ceil(summaryBytes / 4),
    summaryToFullRatio: summaryBytes / fullBytes,
    returnedModuleItems: summary.modules.items.length,
    totalModules: summary.modules.count,
  };
}

const report = {
  schemaVersion: 1,
  accuracy: evaluateAccuracy(),
  performance: evaluatePerformance(),
  sourceCache: evaluateSourceCache(),
  mcp: evaluateMcpBudget(),
  catalog: evaluateCatalogBudget(),
  review: evaluateReviewBudget(),
};

assert.ok(report.accuracy.precision >= budgets.accuracy.minimumPrecision, `precision ${report.accuracy.precision} 低于 ${budgets.accuracy.minimumPrecision}: ${report.accuracy.failures.join("; ")}`);
assert.ok(report.accuracy.recall >= budgets.accuracy.minimumRecall, `recall ${report.accuracy.recall} 低于 ${budgets.accuracy.minimumRecall}: ${report.accuracy.failures.join("; ")}`);
assert.ok(report.accuracy.coveredRules >= budgets.accuracy.minimumCoveredRules, `准确率语料只覆盖 ${report.accuracy.coveredRules}/${report.accuracy.totalRules} 条规则`);
assert.ok(report.accuracy.positiveRules >= budgets.accuracy.minimumPositiveRules, "正例规则覆盖不足");
assert.ok(report.accuracy.negativeRules >= budgets.accuracy.minimumNegativeRules, "反例规则覆盖不足");
assert.ok(report.accuracy.exactCases >= budgets.accuracy.minimumExactCases, "定位/严重度精确样本不足");
assert.ok(report.performance.scopedP95Ms <= budgets.performance.scopedP95Ms, `scoped P95 ${report.performance.scopedP95Ms}ms 超预算`);
assert.ok(report.performance.fullP95Ms <= budgets.performance.fullP95Ms, `full P95 ${report.performance.fullP95Ms}ms 超预算`);
assert.ok(report.performance.scopedGroupRatio <= budgets.performance.maximumScopedGroupRatio, `规则短路比例 ${report.performance.scopedGroupRatio} 超预算`);
assert.strictEqual(report.performance.scopedLoadedFiles, 120, "B13 只应加载 Java 文件");
assert.strictEqual(report.performance.fullLoadedFiles, 240, "全量扫描应加载 Java 与 XML 文件");
assert.strictEqual(report.performance.scopedColdMisses, 120);
assert.strictEqual(report.performance.scopedWarmHits, 120);
assert.strictEqual(report.performance.fullColdMisses, 240);
assert.strictEqual(report.performance.fullWarmHits, 240);
assert.strictEqual(report.sourceCache.warm, "memory");
assert.strictEqual(report.sourceCache.persistent, "persistent");
assert.ok(report.mcp.bytes <= budgets.mcp.maxBytes, `MCP ${report.mcp.bytes} bytes 超预算`);
assert.ok(report.mcp.estimatedTokens <= budgets.mcp.maximumEstimatedTokens, `MCP token 估算 ${report.mcp.estimatedTokens} 超预算`);
assert.strictEqual(report.mcp.cursor, true);
assert.ok(report.catalog.summaryBytes <= budgets.catalog.maximumSummaryBytes, `Catalog 摘要 ${report.catalog.summaryBytes} bytes 超预算`);
assert.ok(report.catalog.summaryEstimatedTokens <= budgets.catalog.maximumSummaryEstimatedTokens, `Catalog 摘要 token 估算 ${report.catalog.summaryEstimatedTokens} 超预算`);
assert.ok(report.catalog.summaryToFullRatio <= budgets.catalog.maximumSummaryToFullRatio, `Catalog 摘要/全文比例 ${report.catalog.summaryToFullRatio} 超预算`);
assert.strictEqual(report.catalog.defaultPageItems, budgets.catalog.defaultPageItems);
assert.strictEqual(report.catalog.nextCursor, budgets.catalog.defaultPageItems);
assert.ok(report.review.summaryBytes <= budgets.review.maximumSummaryBytes, `Review 摘要 ${report.review.summaryBytes} bytes 超预算`);
assert.ok(report.review.estimatedTokens <= budgets.review.maximumEstimatedTokens, `Review 摘要 token 估算 ${report.review.estimatedTokens} 超预算`);
assert.ok(report.review.summaryToFullRatio <= budgets.review.maximumSummaryToFullRatio, `Review 摘要/全文比例 ${report.review.summaryToFullRatio} 超预算`);
assert.strictEqual(report.review.returnedModuleItems, budgets.review.defaultModuleItems);

if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  console.log(`✅ quality eval：${report.accuracy.cases} 例，正/反例规则 ${report.accuracy.positiveRules}/${report.accuracy.negativeRules}，定位样本 ${report.accuracy.exactCases}；precision=${report.accuracy.precision.toFixed(3)} recall=${report.accuracy.recall.toFixed(3)}；scoped/full P95=${report.performance.scopedP95Ms.toFixed(1)}/${report.performance.fullP95Ms.toFixed(1)}ms；MCP≈${report.mcp.estimatedTokens} tokens；Catalog≈${report.catalog.summaryEstimatedTokens} tokens；Review≈${report.review.estimatedTokens} tokens/100 modules`);
}
