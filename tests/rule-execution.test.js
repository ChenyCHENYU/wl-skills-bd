"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runBeRules } = require("../lib/be-rules");
const { GROUPS, RULE_IDS } = require("../lib/be-rule-plan");
const { clearScanContextCache, createScanContext } = require("../lib/scan-context");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-rule-execution-"));
try {
  const registeredRules = new Set(Object.values(GROUPS).flatMap((group) => group.rules));
  assert.deepStrictEqual([...registeredRules].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1))), RULE_IDS, "B1~B32 必须全部登记执行组");
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

  const originalReaddir = fs.readdirSync;
  fs.readdirSync = (directory, ...args) => {
    if (path.resolve(directory) === path.join(root, "src")) {
      const error = new Error("EACCES injected");
      error.code = "EACCES";
      throw error;
    }
    return originalReaddir(directory, ...args);
  };
  try {
    const unreadable = runBeRules(root, { rules: ["B13"], workspace: false });
    assert.strictEqual(unreadable.coverage.status, "partial", "目录无法读取时不得宣称完整覆盖");
    assert.strictEqual(unreadable.coverage.scanComplete, false);
    assert.ok(unreadable.issues.some((item) => item.rule === "WLS_CONFIG" && /目录读取失败/.test(item.message)));
  } finally { fs.readdirSync = originalReaddir; }

  let directoryReads = 0;
  fs.readdirSync = (...args) => { directoryReads += 1; return originalReaddir(...args); };
  let emptyDiscovery;
  try { emptyDiscovery = createScanContext(root, { discoverExtensions: new Set(), readExtensions: new Set() }); }
  finally { fs.readdirSync = originalReaddir; }
  assert.strictEqual(emptyDiscovery.metrics.discoveredFiles, 0);
  assert.strictEqual(directoryReads, 0, "没有文件需求的规则不应遍历整个工程");
  const pageDto = path.join(root, "src", "SamplePageDTO.java");
  fs.writeFileSync(pageDto, "class SamplePageDTO { private Long current = 999L; @Max(1000) private Long size = 20L; }");
  assert.ok(runBeRules(root, { rules: ["B29"], workspace: false }).issues.some((item) => item.rule === "B29"));
  const profile = path.join(root, ".wl-skills-bd", "contracts", "wl-delivery-profile.v1.json");
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  fs.writeFileSync(profile, "{broken");
  const invalidProfile = runBeRules(root, { rules: ["B29"], workspace: false });
  assert.strictEqual(invalidProfile.coverage.status, "partial", "分页 Profile 损坏不得跳过 B29 后报完整");
  assert.ok(invalidProfile.issues.some((item) => item.rule === "WLS_CONFIG" && /分页 Profile/.test(item.message)));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("✅ rule execution：规则前置短路、最小文件发现、共享内容缓存与未知规则 fail-closed 通过");
