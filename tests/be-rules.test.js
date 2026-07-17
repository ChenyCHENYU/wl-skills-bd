"use strict";

/**
 * tests/be-rules.test.js — lib/be-rules.js 回归测试
 *
 * 验证确定性规则引擎能正确检出/不误报典型违规。
 * 对标 wl-skills-kit/tests/ast-rules.test.js。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const { runBeRules } = require("../lib/be-rules");

function fixture(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "be-rules-"));
  fs.mkdirSync(path.join(dir, "controller", "demo"), { recursive: true });
  fs.mkdirSync(path.join(dir, "service", "demo"), { recursive: true });
  fs.mkdirSync(path.join(dir, "mapper", "demo"), { recursive: true });
  fs.mkdirSync(path.join(dir, "resources", "mapper"), { recursive: true });
  return { dir, name, content };
}

function write({ dir, name, content }) {
  fs.writeFileSync(path.join(dir, name), content, "utf8");
}

function hasRule(issues, rule) {
  return issues.filter((i) => i.rule === rule);
}

// ─── B1: Controller 缺 @PreAuthorize ────────────────────────────────────

(function testB1() {
  const f = fixture(
    "controller/demo/BadController.java",
    `package x.controller.demo;
public class BadController {
    @PostMapping("save")
    public ApiResult save() { return null; }
}`,
  );
  write(f);
  const { issues } = runBeRules(f.dir);
  assert.ok(hasRule(issues, "B1").length > 0, "B1 应检出缺 @PreAuthorize");
  console.log("  ✔ B1 检出缺 @PreAuthorize");
})();

// B1 不误报：有 @PreAuthorize 的方法
(function testB1Ok() {
  const f = fixture(
    "controller/demo/GoodController.java",
    `package x.controller.demo;
public class GoodController {
    @PreAuthorize("@pms.hasPermission('x')")
    @PostMapping("save")
    public ApiResult save() { return null; }
}`,
  );
  write(f);
  const { issues } = runBeRules(f.dir);
  assert.strictEqual(hasRule(issues, "B1").length, 0, "B1 不应误报");
  console.log("  ✔ B1 不误报合规方法");
})();

// ─── B3: SELECT * ───────────────────────────────────────────────────────

(function testB3() {
  const f = fixture(
    "resources/mapper/DemoMapper.xml",
    `<mapper><select id="all">SELECT * FROM t</select></mapper>`,
  );
  write(f);
  const { issues } = runBeRules(f.dir);
  assert.ok(hasRule(issues, "B3").length > 0, "B3 应检出 SELECT *");
  console.log("  ✔ B3 检出 SELECT *");
})();

// ─── B4: ${} 注入 ───────────────────────────────────────────────────────

(function testB4() {
  const f = fixture(
    "resources/mapper/InjMapper.xml",
    `<mapper><select id="x">SELECT 1 FROM t WHERE id = ${'$'}{userId}</select></mapper>`,
  );
  write(f);
  const { issues } = runBeRules(f.dir);
  assert.ok(hasRule(issues, "B4").length > 0, "B4 应检出 ${} 注入");
  console.log("  ✔ B4 检出 ${} 注入");
})();

// B4 不误报：MyBatis-Plus 合法用法
(function testB4Ok() {
  const f = fixture(
    "resources/mapper/MpMapper.xml",
    `<mapper><select id="x">${'$'}{ew.customSqlSegment}</select></mapper>`,
  );
  write(f);
  const { issues } = runBeRules(f.dir);
  assert.strictEqual(hasRule(issues, "B4").length, 0, "B4 不应误报 MP 合法用法");
  console.log("  ✔ B4 不误报 MyBatis-Plus 合法用法");
})();

// ─── B8: 裸 RuntimeException ────────────────────────────────────────────

(function testB8() {
  const f = fixture(
    "service/demo/BadServiceImpl.java",
    `package x.service.demo;
public class BadServiceImpl {
    public void save() {
        if (true) throw new RuntimeException("x");
    }
}`,
  );
  write(f);
  const { issues } = runBeRules(f.dir);
  assert.ok(hasRule(issues, "B8").length > 0, "B8 应检出裸 RuntimeException");
  console.log("  ✔ B8 检出裸 RuntimeException");
})();

// ─── stats 结构 ─────────────────────────────────────────────────────────

(function testStats() {
  const f = fixture(
    "controller/demo/S.java",
    `package x.controller.demo; public class S { @PostMapping("s") public void s(){} }`,
  );
  write(f);
  const { stats } = runBeRules(f.dir);
  assert.ok(stats.total >= 0 && typeof stats.byRule === "object");
  assert.strictEqual(stats.error + stats.warn, stats.total, "error+warn=total");
  console.log("  ✔ stats 结构正确");
})();

console.log("\n✅ be-rules 测试全部通过");
