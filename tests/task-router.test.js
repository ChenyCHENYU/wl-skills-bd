"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const taskRouter = require("../lib/task-router");
const ruleCatalog = require("../files/.wl-skills-bd/rules/catalog.json");
const { runBeRules } = require("../lib/be-rules");
const publicApi = require("../lib");

assert.strictEqual(publicApi.taskRouter, taskRouter, "主入口必须公开任务路由能力");
for (const name of ["configDoctor", "configFix", "configInit", "configLayering", "configProbe", "envMatrix", "troubleshoot"]) {
  assert.ok(publicApi[name], `主入口必须公开 ${name}`);
}

const cases = [
  ["加个查询接口", "add-api"],
  ["帮我加个字段落库", "add-field"],
  ["submit审批流", "add-business-cmd"],
  ["改个空指针bug", "fix-bug"],
  ["重构这个大类", "refactor"],
  ["审计一下代码", "audit"],
  ["连不上redis", "config-op"],
  ["新开发销售模块全套CRUD", "new-service"],
];
for (const [input, expected] of cases) {
  const detected = taskRouter.detectTask(input);
  assert.ok(detected, `应识别 "${input}"`);
  assert.strictEqual(detected.task.id, expected, `"${input}" 应识别为 ${expected}`);
}
assert.strictEqual(taskRouter.detectTask("xxxxxxxxrandom12345"), null, "无意义输入应返回 null");

const plan = taskRouter.formatTaskPlan(taskRouter.getTask("add-api"));
assert.match(plan, /B1.*B2.*B5/s);
assert.match(plan, /codegen plan/);
assert.match(plan, /planHash/);
assert.doesNotMatch(plan, /patch-codegen/);
assert.strictEqual(taskRouter.getTask("add-api").mode, "incremental-contract");
assert.deepStrictEqual(taskRouter.buildRuleSubset("add-api"), ["B1", "B2", "B5", "B8", "B12", "B20", "B24", "B25"]);
assert.deepStrictEqual(taskRouter.buildRuleSubset("add-field"), ["B3", "B4", "B7", "B18", "B25"]);
assert.strictEqual(taskRouter.buildRuleSubset("audit").length, 25);
assert.strictEqual(taskRouter.buildRuleSubset("config-op").length, 0);
assert.deepStrictEqual(taskRouter.buildJavaGateSubset("new-service"), ["J1", "J2", "J3", "J8"]);
assert.strictEqual(taskRouter.listTasks().length, 8);
for (const taskId of taskRouter.TASK_IDS) {
  assert.deepStrictEqual(
    taskRouter.buildRuleSubset(taskId),
    ruleCatalog.taskRuleMapping[taskId].rules,
    `${taskId} 规则子集必须与 catalog 单一事实源一致`,
  );
  assert.deepStrictEqual(
    taskRouter.buildJavaGateSubset(taskId),
    ruleCatalog.taskRuleMapping[taskId].javaGates,
    `${taskId} Java 质量门必须与 catalog 单一事实源一致`,
  );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-task-rules-"));
try {
  fs.writeFileSync(path.join(root, "BadService.java"), [
    "public class BadService {",
    "  private RedisTemplate redis;",
    "  private BaseMapper mapper;",
    "  public void cache(String k, String v) { redis.opsForValue().set(k, v); }",
    "  public void del(String id) { mapper.deleteById(id); }",
    "}",
  ].join("\n"));
  const all = runBeRules(root);
  assert.ok(all.issues.some((item) => item.rule === "B13"));
  assert.ok(all.issues.some((item) => item.rule === "B17"));
  const scoped = runBeRules(root, { rules: taskRouter.buildRuleSubset("add-api") });
  assert.ok(!scoped.issues.some((item) => item.rule === "B13"));
  assert.ok(!scoped.issues.some((item) => item.rule === "B17"));
  const fixBug = runBeRules(root, { rules: taskRouter.buildRuleSubset("fix-bug") });
  assert.ok(!fixBug.issues.some((item) => item.rule === "B13"));
  assert.ok(fixBug.issues.some((item) => item.rule === "B17"));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const cli = path.resolve(__dirname, "..", "bin", "wl-skills-bd.js");
const route = spawnSync(process.execPath, [cli, "task", "--type", "add-api"], {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8",
  windowsHide: true,
});
assert.strictEqual(route.status, 0, route.stderr);
assert.match(route.stdout, /codegen plan/);

const blockedWrite = spawnSync(process.execPath, [cli, "task", "--type", "add-api", "--apply"], {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8",
  windowsHide: true,
});
assert.strictEqual(blockedWrite.status, 1, blockedWrite.stdout);
assert.match(blockedWrite.stderr, /task 是只读指挥层/);

console.log("✅ task-router：8 场景、规则子集、契约增量计划与只读写入边界通过");
