"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runBeRules } = require("../lib/be-rules");
const { GROUPS, RULE_IDS } = require("../lib/be-rule-plan");
const { clearScanContextCache } = require("../lib/scan-context");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-rule-execution-"));
try {
  const registeredRules = new Set(Object.values(GROUPS).flatMap((group) => group.rules));
  assert.deepStrictEqual([...registeredRules].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1))), RULE_IDS, "B1~B31 必须全部登记执行组");
  fs.mkdirSync(path.join(root, "src", "mapper"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "CacheService.java"), [
    "class CacheService {",
    "  RedisTemplate redis;",
    "  void cache(String key, String value) { redis.opsForValue().set(key, value); }",
    "}",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "mapper", "BadMapper.xml"), "<mapper><select id=\"x\">SELECT * FROM T</select></mapper>\n");

  clearScanContextCache();
  const scoped = runBeRules(root, { rules: ["B13"] });
  assert.deepStrictEqual(scoped.execution.executedRules, ["B13"]);
  assert.deepStrictEqual(scoped.execution.executedGroups, ["redisTtl"]);
  assert.strictEqual(scoped.execution.scan.discoveredFiles, 1, "B13 不应发现无关 XML");
  assert.strictEqual(scoped.execution.scan.loadedFiles, 1);
  assert.ok(scoped.issues.some((item) => item.rule === "B13"));
  assert.ok(scoped.issues.every((item) => item.rule === "B13"));

  const warm = runBeRules(root, { rules: ["B13"] });
  assert.strictEqual(warm.execution.scan.contentCacheHits, 1, "重复 MCP 扫描应命中进程内内容缓存");
  assert.strictEqual(warm.execution.scan.contentCacheMisses, 0);

  const mapperOnly = runBeRules(root, { rules: ["B3"] });
  assert.deepStrictEqual(mapperOnly.execution.executedGroups, ["mapperSql"]);
  assert.strictEqual(mapperOnly.execution.scan.discoveredFiles, 1, "B3 不应发现无关 Java");
  assert.ok(mapperOnly.issues.some((item) => item.rule === "B3"));

  const invalid = runBeRules(root, { rules: ["B999"] });
  assert.ok(invalid.issues.some((item) => item.rule === "WLS_CONFIG"));
  assert.deepStrictEqual(invalid.execution.unknownRules, ["B999"]);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("✅ rule execution：规则前置短路、最小文件发现、共享内容缓存与未知规则 fail-closed 通过");
