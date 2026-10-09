"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const runtime = require("../lib/task-runtime");
const router = require("../lib/task-router");
const observation = runtime.observation;
const { handleTask, handleDoctor, handleReview } = require("../mcp/tools/lifecycleTools");
const { handleValidate } = require("../mcp/tools/beRulesTools");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-observe-"));
const cli = path.resolve(__dirname, "../bin/wl-skills-bd.js");
const run = (...args) => spawnSync(process.execPath, [cli, ...args, "--target", root, "--json"], { encoding: "utf8" });
const json = (result) => { assert.ok(result.stdout, result.stderr); return JSON.parse(result.stdout); };
const oldRoot = process.env.WL_PROJECT_ROOT;
try {
  const installPlan = json(run("init"));
  assert.strictEqual(run("init", "--confirm", "--plan-hash", installPlan.planHash).status, 0);
  const mcpConfig = JSON.parse(fs.readFileSync(path.join(root, ".vscode/mcp.json"), "utf8"));
  assert.ok(mcpConfig.servers["wl-skills-bd"].args.includes(`${require("../package.json").name}@${require("../package.json").version}`));
  fs.writeFileSync(path.join(root, ".github/standards/20-aaa-other-package.md"), "foreign standard\n");
  assert.ok(router.buildPreflightEvidence("data-safety", root).standards.some((item) => item.id === "20" && !item.file.includes("aaa-other-package")));
  const mapped = new Set(router.TASK_IDS.flatMap((id) => router.getTask(id).skills));
  assert.strictEqual(mapped.size, 13, "13个canonical Skill全部有可解释路线");
  for (const [input, expected] of [["生成单元测试", "generate-tests"], ["MQ 对接", "integration-adapter"], ["模块上下文", "project-context"], ["Redis 缓存缺 TTL", "data-safety"]]) {
    assert.strictEqual(router.detectTask(input).task.id, expected);
  }
  assert.strictEqual(router.classifyTask("Vue 页面加字段").status, "not-applicable");
  assert.strictEqual(router.classifyTask("检查并修复代码").status, "ambiguous");
  assert.strictEqual(router.classifyTask("后端 Java 缺未知规则").status, "gap");
  assert.strictEqual(router.classifyTask("后端 Java 代码改动").status, "baseline");
  assert.strictEqual(router.classifyTask("random").status, "needs-context");
  const comments = router.classifyTask("核对停机实绩服务和 Mapper 的业务边界注释");
  assert.strictEqual(comments.status, "baseline");
  assert.deepStrictEqual(comments.task.rules, ["B12"]);
  assert.deepStrictEqual(comments.task.javaGates, ["J2"]);
  assert.strictEqual(router.classifyTask("给这个文件补上职责注释", null, { targets: ["src/Foo.java"] }).status, "baseline");
  assert.notStrictEqual(router.classifyTask("新增接口并补充 Java 注释").task?.baselineKind, "comments");
  assert.strictEqual(router.classifyTask("审查 outbox 幂等重试与接口设计说明书").task.id, "integration-adapter");
  assert.strictEqual(router.classifyTask("抽取业务文档并整理失败处理").task.id, "extract-business-doc");
  assert.strictEqual(router.classifyTask("给 Vue 页面的图片补注释").status, "not-applicable");
  assert.strictEqual(router.classifyTask("prefix").status, "needs-context");
  assert.strictEqual(router.classifyTask("不要生成单元测试，只做Vue页面").status, "not-applicable");
  assert.strictEqual(router.classifyTask("", "invalid").status, "gap");

  const unknown = json(run("task", "--input", "帮我处理一下"));
  assert.strictEqual(unknown.decision.status, "needs-context");
  assert.strictEqual(unknown.decision.applicable, null);
  assert.deepStrictEqual(unknown.decision.requiredChecks, []);
  const missingContract = json(run("task", "--type", "new-service"));
  assert.strictEqual(missingContract.decision.status, "needs-context");
  assert.strictEqual(missingContract.ready, false);
  assert.ok(missingContract.decision.missingInputs.includes("wl-contract.json"));
  const planned = json(run("task", "--input", "Redis 缓存缺 TTL", "--run-id", "actual-cli"));
  assert.strictEqual(planned.decision.status, "matched");
  assert.strictEqual(planned.executionStatus, "not-executed");
  assert.strictEqual(planned.preflight.modelRead, "unverified");
  assert.ok(planned.pipeline.nodes.every((node) => node.state === "planned"));
  assert.strictEqual(json(run("status", "--run-id", "actual-cli")).validationStatus, "unverified");
  assert.strictEqual(json(run("doctor", "--host", "codex")).hostDiscovery, "unverified");
  assert.strictEqual(json(run("doctor-host")).gateway.status, "present");
  const beforePure = fs.readdirSync(path.join(root, ".wl-skills-bd/runs")).sort();
  assert.strictEqual(json(run("route", "--input", "创建Vue页面")).decision.status, "not-applicable");
  assert.strictEqual(json(run("explain", "--input", "后端未知规则")).runId, undefined);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, ".wl-skills-bd/runs")).sort(), beforePure);
  assert.strictEqual(json(run("explain", "--input", "后端未知规则")).decision.status, "gap");
  assert.strictEqual(json(run("task", "--list")).list.length, 13);
  assert.strictEqual(run("task", "--type", "add-api", "--apply").status, 1);
  assert.strictEqual(json(run("task", "--type", "extract-business-doc")).decision.status, "gap");
  json(run("task", "--input", "后端未知规则"));
  assert.ok(observation.listGaps(runtime.options(root)).length >= 2);

  fs.mkdirSync(path.join(root, "src"));
  const source = path.join(root, "src", "CacheService.java");
  fs.writeFileSync(source, "public class CacheService { RedisTemplate redis; public void cache(String key, String value) { redis.opsForValue().set(key, value); } }");
  const failed = json(run("validate", "src", "--rules", "B13", "--run-id", "actual-cli"));
  assert.strictEqual(failed.receipt.executionStatus, "failed");
  assert.strictEqual(failed.receipt.validationStatus, "failed");
  assert.ok(failed.receipt.checks.some((item) => item.id === "B13" && item.status === "failed"));
  assert.ok(failed.receipt.inputSnapshot.files.some((item) => item.path === "src/CacheService.java"));
  assert.deepStrictEqual(failed.receipt.checkedFiles.map((item) => item.path), ["src/CacheService.java"]);
  fs.writeFileSync(path.join(root, "src", "unchecked.md"), "not a backend source file\n");
  json(run("task", "--input", "Redis 缓存缺 TTL", "--target-file", "src", "--run-id", "scope-real"));
  json(run("validate", "src", "--rules", "B13", "--run-id", "scope-real"));
  assert.ok(json(run("status", "--run-id", "scope-real")).scopeGaps.some((item) => item.path === "src/unchecked.md"));
  fs.appendFileSync(source, "\n// user changed input");
  assert.strictEqual(json(run("status", "--run-id", "actual-cli")).validationStatus, "stale");

  // MCP 同样持有实际检查回执，而不是只返回模型声明。
  process.env.WL_PROJECT_ROOT = root;
  const mcpComments = handleTask({ input: "给 Java 文件补职责注释", targetFile: "src/CacheService.java", runId: "mcp-comments" });
  assert.strictEqual(mcpComments.structuredContent.decision.status, "baseline");
  assert.deepStrictEqual(mcpComments.structuredContent.notice.rules.map((rule) => rule.id), ["B12"]);
  assert.ok(mcpComments.structuredContent.notice.requiredChecks.includes("J2"), "格式质量门单独列为待执行检查");
  assert.ok(mcpComments.text.includes("bd@"));
  assert.ok(!mcpComments.text.includes("B13"), "注释基础约束不能额外展示完整审计规则清单");
  const mcpPlan = handleTask({ input: "生成单元测试", runId: "mcp-test" });
  assert.strictEqual(mcpPlan.structuredContent.decision.status, "matched");
  const mcpScan = handleValidate({ path: "src", rules: ["B13"], runId: "mcp-test" });
  assert.strictEqual(mcpScan.structuredContent.receipt.validationStatus, "failed");
  assert.ok(mcpScan.structuredContent.receipt.checkedFiles.some((item) => item.path === "src/CacheService.java"));
  assert.strictEqual(handleTask({ mode: "status", runId: "mcp-test" }).structuredContent.runId, "mcp-test");
  assert.strictEqual(handleDoctor({ host: "codex" }).structuredContent.hostDiscovery, "unverified");
  assert.strictEqual(handleTask({ list: true }).structuredContent.list.length, 13);
  assert.strictEqual(handleTask({ type: "add-api", apply: true }).isError, true);
  const review = handleReview({ mode: "run", runId: "review-real", rules: ["B13"] });
  assert.ok(review.structuredContent.receipt);
  assert.ok(json(run("review", "run", "--run-id", "review-cli", "--rules", "B13")).receipt);

  // 缺失必需 canonical 文件是安装缺口，不能仍标 ready。
  fs.unlinkSync(path.join(root, ".github/skills/test/unit-test-gen/SKILL.md"));
  const missing = json(run("task", "--input", "生成单元测试"));
  assert.strictEqual(missing.decision.status, "gap");
  assert.strictEqual(missing.ready, false);
  assert.strictEqual(json(run("doctor", "--host", "codex")).entryReadiness, "incomplete");

  // 状态文件与输入路径都拒绝越界，陌生 gateway 即使force也不得覆盖。
  assert.throws(() => runtime.task(root, "单测", { runId: "../escape" }), /runId/);
  assert.throws(() => runtime.task(root, "单测", { targets: ["../outside"] }), /escapes/);
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-foreign-gateway-"));
  try {
    const gateway = path.join(foreign, ".agents/skills/wl-skills-bd/SKILL.md");
    fs.mkdirSync(path.dirname(gateway), { recursive: true }); fs.writeFileSync(gateway, "user gateway\n");
    const preview = spawnSync(process.execPath, [cli, "init", "--target", foreign, "--json"], { encoding: "utf8" });
    const planHash = JSON.parse(preview.stdout).planHash;
    const conflict = spawnSync(process.execPath, [cli, "init", "--force", "--confirm", "--plan-hash", planHash, "--target", foreign, "--json"], { encoding: "utf8" });
    assert.notStrictEqual(conflict.status, 0);
    assert.strictEqual(fs.readFileSync(gateway, "utf8"), "user gateway\n");
    assert.ok(!fs.existsSync(path.join(foreign, "AGENTS.md")), "冲突预检必须零写入");
  } finally { fs.rmSync(foreign, { recursive: true, force: true }); }
} finally {
  if (oldRoot === undefined) delete process.env.WL_PROJECT_ROOT; else process.env.WL_PROJECT_ROOT = oldRoot;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("✅ task observability：13 skills、路由边界、实际CLI/MCP回执、哈希新鲜度和gateway所有权通过");
