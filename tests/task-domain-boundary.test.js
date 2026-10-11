"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { classifyTask } = require("../lib/task-router");
const cli = path.resolve(__dirname, "../bin/wl-skills-bd.js");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-domain-boundary-")));
const run = (...args) => {
  const output = spawnSync(process.execPath, [cli, ...args, "--target", root, "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(output.status, 0, output.stderr || output.stdout);
  return JSON.parse(output.stdout);
};

try {
  fs.writeFileSync(path.join(root, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>audit</groupId><artifactId>fixture</artifactId><version>1</version></project>");
  const preview = run("init");
  run("init", "--confirm", "--plan-hash", preview.planHash);
  for (const input of ["给 Vue 页面加字段", "给 Vue 页面的图片补注释", "修复 Vue CSS 样式", "写诗", "写一首诗", "做饭", "翻译 README", "生成图片"]) {
    assert.equal(classifyTask(input, null, { backendProject: true }).status, "not-applicable", input);
    for (const command of ["task", "route"]) {
      const result = run(command, "--input", input);
      assert.equal(result.decision.status, "not-applicable", input);
      assert.deepEqual(result.decision.selectedSkills, []);
      assert.deepEqual(result.notice.rules, []);
    }
  }
  fs.mkdirSync(path.join(root, "src"));
  for (const target of ["src/App.vue", "src/data.ts", "src/styles.scss", "src/view.tsx"]) {
    fs.writeFileSync(path.join(root, target), "/* isolated target fixture */\n");
    assert.equal(classifyTask("给这个文件加字段", null, { backendProject: true, targets: [target] }).status, "not-applicable", target);
    for (const command of ["task", "route"]) {
      const result = run(command, "--input", "给这个文件加字段", "--target-file", target);
      assert.equal(result.decision.status, "not-applicable", target);
      assert.deepEqual(result.notice.rules, []);
    }
  }
  assert.equal(classifyTask("给这个文件加字段", null, { backendProject: true, targets: ["src/App.vue", "src/Foo.java"] }).task.id, "add-field");
  assert.equal(classifyTask("为 Vue 新增 Java 后端接口", null, { backendProject: true, targets: ["src/App.vue"] }).task.id, "add-api");
  const comments = run("route", "--input", "只补充 Service 注释");
  assert.equal(comments.decision.status, "baseline");
  assert.deepEqual(comments.decision.requiredRules, ["B12"]);
  assert.equal(classifyTask("给这个文件补上职责注释", null, { backendProject: true, targets: ["src/Foo.java"] }).status, "baseline");
  assert.equal(classifyTask("核对 Java Controller 返回给 Vue 的接口", null, { backendProject: true }).status, "gap");
  assert.equal(classifyTask("为 Vue 新增 Java 后端接口", null, { backendProject: true }).task.id, "add-api");
  assert.equal(classifyTask("新增图片上传接口", null, { backendProject: true }).task.id, "add-api");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("✅ task domain：Java 项目上下文不覆盖纯前端/日常意图，明确后端与混合协作保持适用");
