"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { protocol, runOperation } = require("../lib/protocol-cli");
const { invoke } = require("../lib/executor-invoke");
const cli = path.resolve(__dirname, "../bin/wl-skills-bd.js");

function snapshot(root) {
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [[path.relative(root, file), crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]];
  });
  return walk(root).sort(([left], [right]) => left.localeCompare(right));
}

async function fixture(body) {
  const outer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-executor-invoke-")));
  const root = path.join(outer, "project");
  fs.mkdirSync(root);
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--target", root, "--json"], { cwd: root, encoding: "utf8" });
    return { code: result.status, data: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
  };
  const execute = (payload) => {
    const request = path.join(outer, "request.json");
    fs.writeFileSync(request, JSON.stringify({ operation: "execute", projectRoot: root, ...payload }));
    return run("protocol", "request", "--input-file", request);
  };
  try {
    fs.writeFileSync(path.join(root, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>demo</artifactId><version>1</version></project>");
    const plan = run("init");
    assert.equal(plan.code, 0);
    assert.equal(run("init", "--confirm", "--plan-hash", plan.data.planHash).code, 0);
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/GoodService.java"), "public class GoodService {\n    /** 查询当前租户记录。 */\n    public String query() { return \"ok\"; }\n}\n");
    fs.writeFileSync(path.join(root, "src/CacheService.java"), "public class CacheService { RedisTemplate redis; public void cache(String key, String value) { redis.opsForValue().set(key, value); } }\n");
    await body({ root, run, execute });
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
}

test("稳定 execute 单包直连复用真实 validate，业务结果与旧 CLI 同义", async () => fixture(async ({ root, run, execute }) => {
  const planned = run("task", "--input", "只检查 Java Service 职责注释", "--target-file", "src/GoodService.java", "--run-id", "standalone-invoke");
  assert.equal(planned.code, 0);
  assert.equal(planned.data.decision.status, "baseline");
  const source = fs.readFileSync(path.join(root, "src/GoodService.java"));
  const result = execute({ runId: "standalone-invoke", executorId: "validate", parameters: { targets: ["src/GoodService.java"], rules: ["B12"] } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.result.executorId, "validate");
  assert.equal(result.data.result.execution.exitCode, 0);
  assert.equal(result.data.result.execution.signal, null);
  assert.equal(result.data.result.executionStatus, "completed");
  assert.deepEqual(result.data.result.tools.at(-1).checkedFiles.map((item) => item.path), ["src/GoodService.java"]);
  const actual = JSON.parse(result.data.result.execution.stdout);
  const direct = run("validate", "src/GoodService.java", "--rules", "B12", "--run-id", "standalone-invoke");
  assert.equal(direct.code, 0);
  assert.ok(Array.isArray(actual.issues));
  assert.deepEqual(actual.issues, direct.data.issues);
  assert.deepEqual(actual.stats, direct.data.stats);
  assert.deepEqual(fs.readFileSync(path.join(root, "src/GoodService.java")), source);
  const status = run("status", "--run-id", "standalone-invoke");
  assert.equal(status.data.executionStatus, "completed");
  assert.equal(status.data.runId, "standalone-invoke");
  const defaultRules = execute({ runId: "standalone-invoke", executorId: "validate", parameters: { targets: ["src/GoodService.java"] } });
  assert.equal(defaultRules.data.ok, true);
  const defaultResult = JSON.parse(defaultRules.data.result.execution.stdout);
  assert.deepEqual(defaultResult.execution.executedRules, ["B12"], "省略 rules 必须使用计划子集，不能默默执行所有 B 规则");
  assert.deepEqual(defaultResult.issues, actual.issues);
}));

test("原执行器真实失败保留 exitCode、问题与同 runId 失败状态", async () => fixture(async ({ run, execute }) => {
  const planned = run("task", "--input", "检查 Redis 缓存缺 TTL", "--target-file", "src/CacheService.java", "--run-id", "failed-invoke");
  assert.equal(planned.code, 0);
  const result = execute({ runId: "failed-invoke", executorId: "validate", parameters: { targets: ["src/CacheService.java"], rules: ["B13"] } });
  assert.equal(result.data.ok, true, "协议调用完成不能吞掉业务失败回执");
  assert.equal(result.data.result.execution.exitCode, 1);
  assert.equal(result.data.result.executionStatus, "failed");
  const actual = JSON.parse(result.data.result.execution.stdout);
  assert.ok(actual.issues.some((item) => item.rule === "B13"));
  const status = run("status", "--run-id", "failed-invoke");
  assert.equal(status.data.executionStatus, "failed");
  assert.equal(status.data.validationStatus, "failed");
}));

test("Schema、计划目标与未知执行器拒绝不写入项目", async () => fixture(async ({ root, run, execute }) => {
  assert.equal(run("task", "--input", "检查 Java Service 注释", "--target-file", "src/GoodService.java", "--run-id", "refused-invoke").code, 0);
  const before = snapshot(root);
  for (const change of [
    { executorId: "unknown-executor", parameters: { targets: ["src/GoodService.java"] } },
    { executorId: "validate", parameters: { targets: ["src/GoodService.java"], qualityMode: "strict" } },
    { executorId: "validate", parameters: { targets: [] } },
    { executorId: "validate", parameters: { targets: ["src/CacheService.java"] } },
    { executorId: "validate", parameters: { targets: ["src/GoodService.java"], rules: ["B999"] } },
  ]) {
    const result = execute({ runId: "refused-invoke", ...change });
    assert.equal(result.code, 2, JSON.stringify(change));
    assert.equal(result.data.ok, false);
    assert.deepEqual(snapshot(root), before, "准入拒绝必须不产生业务执行记录或改写文件");
  }
}));

test("BD review-run 的根范围限制由包内执行入口拒绝，原检查器不启动", async () => fixture(async ({ root, run }) => {
  assert.equal(run("task", "--input", "检查 Java 后端规范", "--type", "audit", "--target-file", "src/GoodService.java", "--run-id", "review-file").code, 0);
  const helper = require("../lib/executor-process.cjs");
  const original = helper.invokeCli;
  let starts = 0;
  helper.invokeCli = () => { starts += 1; throw new Error("业务执行器不应启动"); };
  try {
    const before = snapshot(root);
    const result = await protocol.requestExecute({ operation: "execute", projectRoot: root, runId: "review-file", executorId: "review-run", parameters: { targets: ["src/GoodService.java"] } }, {
      readStatus: (projectRoot, runId) => runOperation("status", { projectRoot, runId }), invoke,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "unsupported-executor-range");
    assert.equal(starts, 0);
    assert.deepEqual(snapshot(root), before);
  } finally { helper.invokeCli = original; }
}));

test("综合审查保留 audit/new-service/fix-bug/refactor 真实 Skill 准入", async () => fixture(async ({ root }) => {
  fs.copyFileSync(path.resolve(__dirname, "../files/.github/templates/examples/sale-order-master.contract.json"), path.join(root, "wl-contract.json"));
  for (const [type, input] of [
    ["audit", "检查 Java 后端规范"],
    ["new-service", "创建完整 Java 后端服务"],
    ["fix-bug", "修复 Java 后端规范问题"],
    ["refactor", "重构 Java 后端服务"],
  ]) {
    const result = protocol.request({ operation: "route", task: input, type, targets: ["."], projectRoot: root }, runOperation);
    assert.equal(result.ok, true);
    assert.equal(result.result.decision.status, "matched", type);
    assert.ok(result.result.integration.selectedSkills.includes("convention-audit-be"), type);
    assert.ok(result.result.integration.allowedExecutors.includes("review-run"), type);
  }
}));

test("开始后的取消和输出超限留下真实 failed/unverified 中断回执，不遗留 running", async () => fixture(async ({ root, run }) => {
  const helper = require("../lib/executor-process.cjs");
  const runtimeFile = path.resolve(__dirname, "../lib/task-runtime.js");
  for (const mode of ["cancel", "output-limit"]) {
    const runId = `interrupted-${mode}`;
    assert.equal(run("task", "--input", "只检查 Java Service 职责注释", "--target-file", "src/GoodService.java", "--run-id", runId).code, 0);
    const outer = path.dirname(root), marker = path.join(outer, mode + "-started");
    const cliFile = path.join(outer, mode + "-executor.cjs");
    fs.writeFileSync(cliFile, `const fs=require('node:fs');const runtime=require(${JSON.stringify(runtimeFile)});runtime.validationStart(${JSON.stringify(root)},{runId:${JSON.stringify(runId)},targets:['src/GoodService.java']});fs.writeFileSync(${JSON.stringify(marker)},'started');${mode === "output-limit" ? "process.stdout.write('x'.repeat(1024));" : ""}setInterval(()=>{},1000);`);
    let timer, cancellationSent = false;
    const beforeSource = fs.readFileSync(path.join(root, "src/GoodService.java"));
    const result = await protocol.requestExecute({ operation: "execute", projectRoot: root, runId, executorId: "validate", parameters: { targets: ["src/GoodService.java"] } }, {
      readStatus: (projectRoot, id) => runOperation("status", { projectRoot, runId: id }),
      invoke: async () => {
        const processResult = helper.invokeCli({ cli: cliFile, args: [], projectRoot: root, maxOutputBytes: 128 });
        if (mode === "cancel") timer = setInterval(() => {
          if (fs.existsSync(marker)) {
            clearInterval(timer); cancellationSent = true; process.kill(process.pid, "SIGTERM");
          }
        }, 10);
        try { return await processResult; } finally { clearInterval(timer); }
      },
    });
    assert.equal(fs.existsSync(marker), true, "必须真实经过原beginExecution，不能在开始前取消后冒充闭环");
    if (mode === "cancel") {
      assert.equal(cancellationSent, true);
      assert.equal(result.ok, true);
      assert.equal(result.result.execution.cancelled, true);
      assert.equal(result.result.execution.signal, "SIGKILL");
      assert.equal(result.result.executionStatus, "failed");
    } else {
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "executor-output-limit");
    }
    const status = run("status", "--run-id", runId).data;
    assert.equal(status.executionStatus, "failed");
    assert.equal(status.validationStatus, "unverified");
    const started = status.records.filter(record => record.kind === "tool-started");
    const finished = status.records.filter(record => record.kind === "tool-finished");
    assert.equal(started.length, 1); assert.equal(finished.length, 1);
    assert.equal(Number.isInteger(started[0].producer.pid), true);
    assert.ok(started[0].producer.pid > 0);
    if (mode === "cancel") assert.equal(started[0].producer.pid, result.result.execution.processId);
    assert.equal(finished[0].executionId, started[0].eventId);
    assert.equal(finished[0].executionStatus, "failed");
    assert.equal(finished[0].validationStatus, "unverified");
    assert.deepEqual(finished[0].checks, []); assert.deepEqual(finished[0].checkedFiles, []);
    assert.equal(finished[0].errorCode, mode === "cancel" ? "executor-cancelled" : "executor-output-limit");
    assert.deepEqual(fs.readFileSync(path.join(root, "src/GoodService.java")), beforeSource);
  }
}));

test("BD review-run 根目标复用原 review 回执；解释任务不执行", async () => fixture(async ({ root, run, execute }) => {
  assert.equal(run("task", "--input", "检查 Java 后端规范", "--type", "audit", "--target-file", ".", "--run-id", "review-root").code, 0);
  const result = execute({ runId: "review-root", executorId: "review-run", parameters: { targets: ["."] } });
  assert.equal(result.data.ok, true);
  assert.equal(result.data.result.executorId, "review-run");
  assert.equal(result.data.result.execution.exitCode, 1, "当前违规样例须保留真实 review 阻断");
  assert.equal(result.data.result.tools.at(-1).tool, "backend-change-review");
  assert.equal(JSON.parse(result.data.result.execution.stdout).receipt.executionStatus, "failed");
  assert.equal(run("task", "--input", "只检查 Java Service 注释", "--target-file", ".", "--run-id", "root-comments-only").code, 0);
  const comments = protocol.request({ operation: "status", projectRoot: root, runId: "root-comments-only" }, runOperation);
  assert.deepEqual(comments.result.integration.allowedExecutors, ["validate"], "注释基础任务不能准入整个项目的综合 review");
  const beforeReview = snapshot(root);
  const reviewRefused = execute({ runId: "root-comments-only", executorId: "review-run", parameters: { targets: ["."] } });
  assert.equal(reviewRefused.data.ok, false);
  assert.equal(reviewRefused.data.error.code, "executor-not-allowed");
  assert.deepEqual(snapshot(root), beforeReview);
  run("task", "--input", "解释 Java 后端注释规范，不要运行检查", "--target-file", "src/GoodService.java", "--run-id", "explain-only");
  const before = snapshot(root);
  const refused = execute({ runId: "explain-only", executorId: "validate", parameters: { targets: ["src/GoodService.java"] } });
  assert.equal(refused.data.ok, false);
  assert.deepEqual(snapshot(root), before);
}));
