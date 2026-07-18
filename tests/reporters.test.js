"use strict";

const assert = require("assert");
const { toJson, toMarkdown, toSarif, toText } = require("../lib/reporters");

const result = {
  schemaVersion: 1,
  targetDir: "D:/project",
  durationMs: 3,
  stats: { error: 1, warn: 0, info: 0, total: 1, suppressed: 1, byRule: { B1: 1 } },
  issues: [{ rule: "B1", severity: "error", file: "src/Demo.java", line: 8, col: 2, endLine: 8, message: "缺权限", standard: "04/11", fingerprint: "abc" }],
  suppressed: [{ rule: "B2", severity: "warn", file: "src/Demo.java", line: 8, col: 2, message: "缺文档", suppressionReason: "遗留接口已有工单" }],
};

assert.strictEqual(JSON.parse(toJson(result)).stats.error, 1);
const sarif = JSON.parse(toSarif(result));
assert.strictEqual(sarif.version, "2.1.0");
assert.strictEqual(sarif.runs[0].results[0].locations[0].physicalLocation.region.startColumn, 2);
assert.strictEqual(sarif.runs[0].results[0].partialFingerprints.primaryLocationLineHash, "abc");
assert.match(toMarkdown(result), /已批准抑制/);
assert.match(toText(result), /ERROR B1 src\/Demo\.java:8:2/);

console.log("✅ reporters：text、JSON、Markdown 与 SARIF 2.1.0 输出通过");
