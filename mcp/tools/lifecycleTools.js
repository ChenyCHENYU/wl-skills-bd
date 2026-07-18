"use strict";

const fs = require("fs");
const path = require("path");
const codegen = require("../../lib/codegen");
const collaboration = require("../../lib/collaboration");
const { loadContract } = require("../../lib/contract");
const { runDoctor } = require("../../lib/doctor");
const safeFix = require("../../lib/safe-fix");
const { projectRoot, readableProjectFile } = require("../project-root");
const { blockedResult, completedResult, previewResult, toolResult } = require("../tool-result");

function contractAndManifest(root, rel) {
  const file = readableProjectFile(root, rel, "后端契约");
  const loaded = loadContract(file, { projectRoot: root });
  if (!loaded.ok) return { loaded };
  const implementation = codegen.inspectImplementation(loaded.contract, root);
  return {
    loaded,
    implementation,
    manifest: collaboration.buildManifest(loaded.contract, loaded.profile, loaded.deliveryProfile, {
      implementedOperations: implementation.implementedOperations,
    }),
  };
}

function validationText(result) {
  return result.errors.map((error) => `${error.path}: ${error.message}`).join("\n");
}

function handleCodegen(args) {
  const root = projectRoot();
  let file;
  try {
    file = readableProjectFile(root, args.contract, "后端契约");
  } catch (error) {
    return blockedResult(error.message, "invalid-input");
  }
  if (args.mode === "validate") {
    const loaded = loadContract(file, { projectRoot: root });
    if (!loaded.ok) return blockedResult(`契约校验失败\n${validationText(loaded)}`, "invalid-contract", { errors: loaded.errors });
    return toolResult(`✅ 契约有效：${loaded.contract.contractId} (${loaded.profile.id})`, {
      ok: true,
      state: "validated",
      contractId: loaded.contract.contractId,
      profile: loaded.profile.id,
      features: {
        alter: Boolean(loaded.contract.alter),
        customOperations: (loaded.contract.customOperations || []).length,
        relations: (loaded.contract.relations || []).length,
        indexes: (loaded.contract.indexes || []).length,
        export: Boolean(loaded.contract.api.permissions && loaded.contract.api.permissions.export),
        externalId: loaded.contract.externalId || null,
      },
    });
  }
  const plan = codegen.buildPlan(file, { projectRoot: root });
  if (!plan.ok) return blockedResult(`契约校验失败\n${validationText(plan)}`, "invalid-contract", { errors: plan.errors });
  const publicPlan = codegen.publicPlan(plan);
  if (args.mode === "plan") {
    return previewResult(`代码生成预览：${plan.actions.length} 个受管产物\nplanHash: ${plan.planHash}\n确认后携带相同 planHash 并传 confirmApply: true。`, publicPlan);
  }
  if (args.confirmApply !== true) {
    return blockedResult("codegen apply 必须传 confirmApply: true", "confirm-required", { currentPlanHash: plan.planHash });
  }
  const result = codegen.applyPlan(plan, {
    confirm: true,
    planHash: args.planHash,
    force: args.force === true,
    requireComplete: args.requireComplete === true,
    allowProductionWrites: args.allowProductionWrites === true,
  });
  if (!result.ok) {
    return blockedResult(`代码生成零写入：${result.reason}`, result.reason, {
      currentPlanHash: result.expectedPlanHash || plan.planHash,
      conflicts: (result.blocked || []).map((item) => item.rel),
      completion: result.completion,
    });
  }
  return completedResult(`✅ codegen 已写入/核对 ${result.applied.length} 个受管产物`, result);
}

function handleContract(args) {
  const root = projectRoot();
  let value;
  try {
    value = contractAndManifest(root, args.contract);
  } catch (error) {
    return blockedResult(error.message, "invalid-input");
  }
  if (!value.loaded.ok) return blockedResult(`契约校验失败\n${validationText(value.loaded)}`, "invalid-contract", { errors: value.loaded.errors });
  if (args.mode === "show") {
    const format = args.format || "json";
    const text = format === "markdown"
      ? collaboration.renderMarkdown(value.manifest)
      : JSON.stringify(value.manifest, null, 2);
    return toolResult(text, {
      ok: true,
      state: "rendered",
      format,
      manifest: value.manifest,
      implementation: value.implementation,
    });
  }
  if (!args.frontend && !args.openapi && !args.permissions && !args.kitApiMd) {
    return blockedResult("contract diff 至少需要 frontend/openapi/permissions/kitApiMd 之一", "invalid-input");
  }
  const checks = {};
  try {
    if (args.frontend) {
      const file = readableProjectFile(root, args.frontend, "前端契约");
      checks.frontend = collaboration.compareManifest(
        value.manifest,
        collaboration.readManifestArtifact(file),
        { strict: args.strict === true },
      );
    }
    if (args.openapi) {
      const file = readableProjectFile(root, args.openapi, "OpenAPI 文档");
      checks.openapi = collaboration.compareOpenApi(value.manifest, JSON.parse(fs.readFileSync(file, "utf8")));
    }
    if (args.permissions) {
      const file = readableProjectFile(root, args.permissions, "权限清单");
      const content = fs.readFileSync(file, "utf8");
      checks.permissions = collaboration.comparePermissions(
        value.manifest,
        path.extname(file).toLowerCase() === ".json" ? JSON.parse(content) : content,
        args.permissions,
      );
    }
    if (args.kitApiMd) {
      const file = readableProjectFile(root, args.kitApiMd, "kit api.md");
      checks.kitApiMd = collaboration.compareKitApiMarkdown(
        value.manifest,
        fs.readFileSync(file, "utf8"),
        args.kitApiMd,
        { strict: args.strict === true },
      );
    }
  } catch (error) {
    return blockedResult(error.message, "invalid-input");
  }
  const errors = Object.entries(checks).flatMap(([source, result]) => result.errors.map((item) => ({ source, ...item })));
  const warnings = Object.entries(checks).flatMap(([source, result]) => result.warnings.map((item) => ({ source, ...item })));
  const blockingWarnings = warnings.filter((item) => item.code !== "C113");
  const strictFailed = args.strict === true && blockingWarnings.length > 0;
  const ok = errors.length === 0 && !strictFailed;
  const lines = [ok ? "✅ 契约差异检查通过" : "❌ 契约差异检查未通过"];
  for (const item of errors) lines.push(`[${item.source}/${item.code}] ${item.path}: ${item.message}`);
  for (const item of warnings) lines.push(`[${item.source}/${item.code}] ${item.path}: ${item.message}`);
  return toolResult(lines.join("\n"), {
    ok,
    state: ok ? "verified" : "differences-found",
    contractId: value.loaded.contract.contractId,
    checks,
    errors,
    warnings,
    summary: { errors: errors.length, warnings: warnings.length, blockingWarnings: blockingWarnings.length },
  }, !ok);
}

function handleDoctor() {
  const result = runDoctor(projectRoot());
  const lines = result.checks.map((item) => `${item.ok ? "✅" : "❌"} ${item.id}: ${item.detail}${item.ok ? "" : `\n  → ${item.fix}`}`);
  return toolResult(lines.join("\n"), result, !result.ok);
}

function handleFix(args) {
  const root = projectRoot();
  let plan;
  try {
    plan = safeFix.buildFixPlan(root, { scanRel: args.path, rules: args.rules });
  } catch (error) {
    return blockedResult(error.message, "invalid-input");
  }
  if (!plan.ok) return blockedResult(`只允许自动修复 ${plan.safeRules.join("/")}；其余规则必须人工处理`, plan.reason, { unsupported: plan.unsupported, safeRules: plan.safeRules });
  const preview = safeFix.publicFixPlan(plan);
  if (args.confirmApply !== true) {
    const text = [
      `安全修复预览：${preview.actions.length} 个文件，${preview.selected} 个选中问题，${preview.manual.length} 个人工项`,
      `planHash: ${preview.planHash}`,
      `复扫报告：${preview.reportRel}`,
      "确认 diff 后携带相同 planHash 并传 confirmApply: true。",
    ].join("\n");
    return previewResult(text, preview);
  }
  const result = safeFix.applyFixPlan(plan, { confirm: true, planHash: args.planHash });
  if (!result.ok) return blockedResult(`安全修复零写入：${result.reason}`, result.reason, {
    currentPlanHash: result.expectedPlanHash || plan.planHash,
    manual: result.manual,
  });
  const text = [
    `✅ 安全修复已应用：${result.applied.length} 个文件`,
    `复扫：fixed=${result.closure.fixed}, remaining=${result.closure.remaining}, regressions=${result.closure.regressions}`,
    `报告：${result.reportRel}`,
  ].join("\n");
  return toolResult(text, result, !result.closure.selectedOk);
}

function handleDbPreview(args) {
  const root = projectRoot();
  let file;
  try {
    file = readableProjectFile(root, args.contract, "后端契约");
  } catch (error) {
    return blockedResult(error.message, "invalid-input");
  }
  const loaded = loadContract(file, { projectRoot: root });
  if (!loaded.ok) return blockedResult(`契约校验失败\n${validationText(loaded)}`, "invalid-contract", { errors: loaded.errors });
  const { contract } = loaded;
  const migrationSql = codegen.renderMigration(contract);
  const migrationFile = codegen.migrationFileBase(contract);
  const isAlter = Boolean(contract.alter);
  const expandContractPhases = isAlter
    ? [
      { phase: "expand", operations: contract.alter.operations.filter((op) => op.type === "add" || op.type === "modify").map((op) => op.type) },
      { phase: "deploy-compatible", operations: ["发布兼容新旧 schema 的应用"] },
      { phase: "backfill", operations: contract.alter.operations.filter((op) => op.type === "add").map((op) => `回填 ${op.field ? op.field.column : "-"}`) },
      { phase: "switch", operations: ["切换读写到新结构"] },
      { phase: "contract", operations: contract.alter.operations.filter((op) => op.type === "drop").map((op) => `DROP ${op.column}`) },
    ].filter((p) => p.operations.length > 0 || p.phase === "deploy-compatible" || p.phase === "switch")
    : [{ phase: "create", operations: [`CREATE TABLE ${contract.entity.table}`] }];
  const indexes = (contract.indexes || []).map((idx) => ({ name: idx.name, columns: idx.columns, unique: idx.unique }));
  const lines = [
    `DDL 预览（${isAlter ? "ALTER" : "CREATE"}） — ${contract.contractId}`,
    `迁移文件：${migrationFile}`,
    `数据库：${contract.database}`,
    "",
    "```sql",
    migrationSql,
    "```",
    "",
    `Expand-Contract 阶段：${expandContractPhases.map((p) => `${p.phase}(${p.operations.length})`).join(" → ") || "不适用"}`,
    indexes.length > 0 ? `自定义索引：${indexes.length} 个` : "无自定义索引（仅默认 COMPANY_ID+IS_DELETE 联合索引）",
    "",
    "本预览只读；写入仍需通过 wls_be_codegen plan/apply 携带 planHash 与 confirmApply。",
  ];
  return toolResult(lines.join("\n"), {
    ok: true,
    state: "previewed",
    contractId: contract.contractId,
    migrationFile,
    migrationKind: isAlter ? "ALTER" : "CREATE",
    database: contract.database,
    migrationSql,
    expandContractPhases,
    indexes,
  });
}

function handleExportPermissions(args) {
  const root = projectRoot();
  let file;
  try {
    file = readableProjectFile(root, args.contract, "后端契约");
  } catch (error) {
    return blockedResult(error.message, "invalid-input");
  }
  const loaded = loadContract(file, { projectRoot: root });
  if (!loaded.ok) return blockedResult(`契约校验失败\n${validationText(loaded)}`, "invalid-contract", { errors: loaded.errors });
  const manifest = collaboration.buildManifest(loaded.contract, loaded.profile);
  const inventory = collaboration.buildPermissionInventory(manifest);
  const markdown = collaboration.renderPermissionInventoryMarkdown(inventory);
  if (args.confirmApply !== true) {
    return previewResult(`权限码导出预览：${inventory.rows.length} 个权限码。确认后传 confirmApply: true 写入 ${args.output || "reports/SYS_PERMISSION_INFO_{contractId}.md"}。`, { inventory, markdown, output: args.output || null });
  }
  const outputRel = args.output || `reports/SYS_PERMISSION_INFO_${inventory.contractId}.md`;
  const { resolveWithin, writeTextAtomic } = require("../../lib/manifest");
  let destination;
  try {
    destination = resolveWithin(root, outputRel);
  } catch (error) {
    return blockedResult(error.message, "invalid-input");
  }
  writeTextAtomic(destination, markdown);
  return completedResult(`✅ 已导出 ${inventory.rows.length} 个权限码到 ${outputRel}`, { output: outputRel, inventory });
}

function handleConfig(args) {
  const root = projectRoot();
  const subcommand = args.subcommand;
  if (subcommand === "doctor") {
    const { runConfigDoctor } = require("../../lib/config-doctor");
    const result = runConfigDoctor(root, {
      probe: args.probe === true,
      probeTimeoutMs: typeof args.probeTimeoutMs === "number" ? args.probeTimeoutMs : 3000,
    });
    const lines = result.checks.map((c) => `${c.ok ? "✅" : (c.severity === "warn" ? "⚠️ " : "❌")} ${c.id}: ${c.detail}${!c.ok && c.fix ? `\n  → ${c.fix}` : ""}`);
    return toolResult(lines.join("\n"), result, !result.ok);
  }
  if (subcommand === "init") {
    const configInit = require("../../lib/config-init");
    const plan = configInit.buildInitPlan(root, {
      project: args.project,
      module: args.module,
      port: typeof args.port === "number" ? args.port : undefined,
      datasourceType: args.datasourceType,
      customer: args.customer,
    });
    if (args.confirmApply !== true) {
      return previewResult(`config init 预览：将生成 ${plan.actions.length} 个配置文件。确认后传 confirmApply: true。`, { actions: plan.actions.map((a) => ({ rel: a.rel, kind: a.kind, env: a.env })) });
    }
    const result = configInit.applyInitPlan(plan, { projectRoot: root, confirm: true, overwrite: args.overwrite === true });
    return completedResult(`✅ config init 完成：${result.applied.filter((a) => a.result === "created").length} 创建`, result);
  }
  if (subcommand === "migrate") {
    const envMatrix = require("../../lib/env-matrix");
    if (!args.to) return blockedResult("config migrate 需要 to 参数", "invalid-input");
    const plan = envMatrix.buildMigrationPlan(root, { to: args.to, from: args.from });
    if (!plan.ok) return blockedResult(`config migrate 失败：${plan.reason}${plan.customer ? "（" + plan.customer + "）" : ""}`, plan.reason);
    if (args.confirmApply !== true) {
      return previewResult(`config migrate 预览：${plan.from} → ${plan.to}，${plan.diffs.length} 项差异，${plan.actions.length} 个文件。planHash: ${plan.planHash}`, envMatrix.publicMigrationPlan(plan));
    }
    const result = envMatrix.applyMigrationPlan(plan, { projectRoot: root, confirm: true, planHash: args.planHash });
    if (!result.ok) return blockedResult(`config migrate apply 失败：${result.reason}`, result.reason);
    return completedResult(`✅ config migrate 完成：${plan.from} → ${plan.to}，生成 ${result.applied.length} 个文件`, result);
  }
  if (subcommand === "fix") {
    const configFix = require("../../lib/config-fix");
    const plan = configFix.buildFixPlan(root);
    if (args.confirmApply !== true) {
      return previewResult(`config fix 预览：${plan.summary.total} 处明文敏感信息，可修复 ${plan.summary.fixed}`, plan);
    }
    const result = configFix.applyFixPlan(plan, { projectRoot: root, confirm: true });
    return completedResult(`✅ config fix 完成：修复 ${result.closure.fixed}，剩余 ${result.closure.remaining}`, result);
  }
  return blockedResult(`未知 config 子命令：${subcommand}（支持 doctor/init/migrate/fix）`, "invalid-input");
}

function handleTroubleshoot(args) {
  const ts = require("../../lib/troubleshoot");
  if (args.list === true) {
    return toolResult("故障诊断项：\n" + ts.listAllDiagnostics().map((d) => `  ${d.id}: ${d.title}`).join("\n"), { ok: true, list: ts.listAllDiagnostics() });
  }
  if (!args.keyword) return blockedResult("troubleshoot 需要 keyword 参数或 list=true", "invalid-input");
  const result = ts.troubleshoot(args.keyword);
  return toolResult(result.output, result, !result.ok);
}

function handleTask(args) {
  const taskRouter = require("../../lib/task-router");
  if (args.apply !== undefined) {
    return blockedResult("task 是只读指挥层；实际写入请使用 codegen/safe-fix/config 的计划、确认与回滚链", "invalid-input");
  }
  if (args.list === true) {
    return toolResult("任务类型：\n" + taskRouter.listTasks().map((t) => `  ${t.id}: ${t.name}（${t.mode}）`).join("\n"), { ok: true, list: taskRouter.listTasks() });
  }
  // 模式 1：自然语言识别
  if (args.input && !args.type) {
    const detected = taskRouter.detectTask(args.input);
    if (!detected) {
      return blockedResult(`未识别任务意图："${args.input}"，可用 --list 查看`, "no-match");
    }
    return toolResult(taskRouter.formatTaskPlan(detected.task), {
      ok: true,
      taskId: detected.task.id,
      taskName: detected.task.name,
      mode: detected.task.mode,
      rules: detected.task.rules,
      skills: detected.task.skills,
      candidates: detected.candidates,
    });
  }
  // 模式 2：指定 type 输出统一安全写链。
  if (args.type) {
    const task = taskRouter.getTask(args.type);
    if (!task) return blockedResult(`未知任务类型：${args.type}`, "invalid-input");
    return toolResult(taskRouter.formatTaskPlan(task, { targetFile: args.targetFile }), { ok: true, taskId: args.type, taskName: task.name, mode: task.mode, rules: task.rules, skills: task.skills });
  }
  return blockedResult("task 需要 input（自然语言）或 type（指定）参数，或 list=true", "invalid-input");
}

module.exports = { handleCodegen, handleConfig, handleContract, handleDbPreview, handleDoctor, handleExportPermissions, handleFix, handleTask, handleTroubleshoot };
