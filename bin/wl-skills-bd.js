#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const { runBeRules } = require("../lib/be-rules");
const codegen = require("../lib/codegen");
const collaboration = require("../lib/collaboration");
const { loadContract } = require("../lib/contract");
const { runDoctor } = require("../lib/doctor");
const installer = require("../lib/installer");
const { resolveWithin, writeTextAtomic } = require("../lib/manifest");
const { formatReport } = require("../lib/reporters");
const safeFix = require("../lib/safe-fix");
const permissionExport = require("../lib/permission-export");

function has(args, flag) {
  return args.includes(flag);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function targetRoot(args) {
  return path.resolve(option(args, "--target", process.cwd()));
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printPlan(plan) {
  const labels = {
    add: "+ 新增",
    update: "~ 更新",
    unchanged: "= 未变",
    conflict: "! 冲突",
    "remove-stale": "- 移除旧文件",
    "preserve-stale": "! 保留已修改旧文件",
    "stale-missing": "= 旧文件已不存在",
  };
  for (const item of plan.actions) {
    console.log(`${labels[item.action] || item.action}  ${item.rel}`);
  }
  console.log(`\n汇总：${JSON.stringify(plan.summary)}`);
}

function printCodegenPlan(plan) {
  if (!plan.ok) {
    for (const error of plan.errors || []) console.error(`${error.path}: ${error.message}`);
    return;
  }
  const labels = {
    add: "+ 新增",
    update: "~ 更新",
    unchanged: "= 未变",
    conflict: "! 冲突",
    "remove-stale": "- 移除过期产物",
    "preserve-stale": "! 保留已修改的过期产物",
    "stale-missing": "= 过期产物已不存在",
  };
  for (const item of plan.actions) {
    console.log(`${labels[item.action] || item.action}  ${item.rel}${item.reason ? ` (${item.reason})` : ""}`);
  }
  console.log(`\nplanHash: ${plan.planHash}`);
  console.log(`汇总：${JSON.stringify(plan.summary)}`);
}

function commandInstall(command, args) {
  const root = targetRoot(args);
  const dryRun = has(args, "--dry-run");
  const force = has(args, "--force");
  const plan = installer.buildPlan(root);
  if (has(args, "--json")) printJson({ command, root, plan: plan.actions, summary: plan.summary });
  else {
    console.log(`[wl-skills-bd] ${command} → ${root}${dryRun ? " (dry-run)" : ""}\n`);
    printPlan(plan);
  }
  if (command === "diff") {
    return plan.actions.some((item) => !["unchanged", "stale-missing"].includes(item.action)) ? 1 : 0;
  }
  const result = installer.applyPlan(plan, { dryRun, force });
  if (!has(args, "--json") && result.blocked.length) {
    console.error("\n存在本地修改冲突，本次零写入。请先处理 diff；确需覆盖时使用 --force，原文件会备份。");
  }
  return result.ok ? 0 : 2;
}

function commandClean(args) {
  const root = targetRoot(args);
  const result = installer.clean(root, { dryRun: has(args, "--dry-run") });
  if (has(args, "--json")) printJson(result);
  else if (!result.ok) console.error(`无法 clean：${result.reason}`);
  else console.log(`移除 ${result.removed.length} 个受管文件；保留 ${result.preserved.length} 个本地修改文件。`);
  return result.ok ? 0 : 1;
}

function commandCheck(args) {
  const result = installer.check(targetRoot(args));
  if (has(args, "--json")) printJson(result);
  else {
    console.log(result.ok ? `✅ 安装完整：v${result.version}` : "❌ 安装不完整或存在漂移");
    for (const item of result.drift || []) console.log(`  ${item.status}: ${item.rel}`);
    for (const error of result.errors || []) console.log(`  ${error}`);
  }
  return result.ok ? 0 : 1;
}

function commandValidate(args) {
  const root = targetRoot(args);
  const valueOptions = new Set(["--target", "--format", "--output"]);
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    if (valueOptions.has(args[index])) { index += 1; continue; }
    if (!args[index].startsWith("-")) positionals.push(args[index]);
  }
  const positional = positionals[0];
  const result = runBeRules(root, { scanRel: positional, quick: has(args, "--quick") });
  const format = has(args, "--json") ? "json" : option(args, "--format", "text");
  let rendered;
  try {
    rendered = formatReport(result, format);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const output = option(args, "--output");
  if (output) {
    try {
      const destination = resolveWithin(root, output);
      writeTextAtomic(destination, rendered);
      if (format !== "json") console.log(`报告已写入 ${destination}`);
    } catch (error) {
      console.error(`无法写入报告：${error.message}`);
      return 1;
    }
  } else {
    process.stdout.write(rendered);
  }
  const strict = has(args, "--strict");
  return result.stats.error > 0 || (strict && result.stats.warn > 0) ? 1 : 0;
}

function commandDoctor(args) {
  const result = runDoctor(targetRoot(args));
  if (has(args, "--json")) printJson(result);
  else {
    for (const item of result.checks) {
      console.log(`${item.ok ? "✅" : "❌"} ${item.id}: ${item.detail}`);
      if (!item.ok) console.log(`   → ${item.fix}`);
    }
  }
  return result.ok ? 0 : 1;
}

function commandCodegen(args) {
  const [subcommand = "help", contractArg, ...rest] = args;
  const allArgs = contractArg === undefined ? rest : [contractArg, ...rest];
  const root = targetRoot(allArgs);
  if (!contractArg || contractArg.startsWith("-")) {
    console.error("codegen 需要契约文件路径");
    return 1;
  }
  if (subcommand === "validate") {
    const result = loadContract(contractArg, { projectRoot: root });
    const output = {
      ok: result.ok,
      contractFile: result.file,
      contractId: result.contract && result.contract.contractId,
      profile: result.profile && result.profile.id,
      errors: result.errors,
    };
    if (has(allArgs, "--json")) printJson(output);
    else if (result.ok) console.log(`✅ 契约有效：${output.contractId} (${output.profile})`);
    else for (const error of result.errors) console.error(`${error.path}: ${error.message}`);
    return result.ok ? 0 : 1;
  }
  if (!["plan", "apply"].includes(subcommand)) {
    console.error(`未知 codegen 子命令：${subcommand}`);
    return 1;
  }
  const plan = codegen.buildPlan(contractArg, { projectRoot: root });
  if (subcommand === "plan") {
    if (has(allArgs, "--json")) printJson(codegen.publicPlan(plan));
    else printCodegenPlan(plan);
    return plan.ok ? 0 : 1;
  }
  const result = codegen.applyPlan(plan, {
    confirm: has(allArgs, "--confirm"),
    force: has(allArgs, "--force"),
    requireComplete: has(allArgs, "--require-complete"),
    planHash: option(allArgs, "--plan-hash"),
  });
  if (has(allArgs, "--json")) printJson(result);
  else if (result.ok) console.log(`✅ 已按 planHash 写入 ${result.applied.length} 个受管产物`);
  else {
    console.error(`代码生成未写入：${result.reason || "契约校验失败"}`);
    if (result.expectedPlanHash) console.error(`当前 planHash: ${result.expectedPlanHash}`);
    for (const item of (result.completion && result.completion.openQuestions) || []) console.error(`  未完成：${item}`);
    for (const item of result.blocked || []) console.error(`  冲突：${item.rel}`);
  }
  return result.ok ? 0 : 2;
}

function commandContract(args) {
  const [subcommand = "help", contractArg, ...rest] = args;
  const allArgs = contractArg === undefined ? rest : [contractArg, ...rest];
  const root = targetRoot(allArgs);
  if (!contractArg || contractArg.startsWith("-")) {
    console.error("contract 需要后端契约文件路径");
    return 1;
  }
  const loaded = loadContract(contractArg, { projectRoot: root });
  if (!loaded.ok) {
    if (has(allArgs, "--json")) printJson({ ok: false, errors: loaded.errors });
    else for (const error of loaded.errors) console.error(`${error.path}: ${error.message}`);
    return 1;
  }
  const implementation = codegen.inspectImplementation(loaded.contract, root);
  const manifest = collaboration.buildManifest(loaded.contract, loaded.profile, loaded.deliveryProfile, {
    implementedOperations: implementation.implementedOperations,
  });
  if (subcommand === "show") {
    const format = option(allArgs, "--format", has(allArgs, "--json") ? "json" : "markdown");
    let content;
    if (format === "json") content = `${JSON.stringify(manifest, null, 2)}\n`;
    else if (format === "markdown") content = collaboration.renderMarkdown(manifest);
    else {
      console.error("contract show --format 只支持 json/markdown");
      return 1;
    }
    const output = option(allArgs, "--output");
    if (output) {
      const destination = resolveWithin(root, output);
      writeTextAtomic(destination, content);
      if (!has(allArgs, "--json")) console.log(`✅ 已写入验证后的协作契约：${output}`);
    } else process.stdout.write(content);
    return 0;
  }
  if (subcommand !== "diff") {
    console.error(`未知 contract 子命令：${subcommand}`);
    return 1;
  }

  const inputs = {
    frontend: option(allArgs, "--frontend"),
    openapi: option(allArgs, "--openapi"),
    permissions: option(allArgs, "--permissions"),
    kitApiMd: option(allArgs, "--kitApiMd") || option(allArgs, "--kit-api-md"),
  };
  if (!Object.values(inputs).some(Boolean)) {
    console.error("contract diff 至少需要 --frontend、--openapi、--permissions 或 --kitApiMd 之一");
    return 1;
  }
  const checks = {};
  try {
    if (inputs.frontend) {
      const file = resolveWithin(root, inputs.frontend);
      checks.frontend = collaboration.compareManifest(
        manifest,
        collaboration.readManifestArtifact(file),
        { strict: has(allArgs, "--strict") },
      );
    }
    if (inputs.openapi) {
      const file = resolveWithin(root, inputs.openapi);
      checks.openapi = collaboration.compareOpenApi(manifest, JSON.parse(fs.readFileSync(file, "utf8")));
    }
    if (inputs.permissions) {
      const file = resolveWithin(root, inputs.permissions);
      const content = fs.readFileSync(file, "utf8");
      const inventory = path.extname(file).toLowerCase() === ".json" ? JSON.parse(content) : content;
      checks.permissions = collaboration.comparePermissions(manifest, inventory, inputs.permissions);
    }
    if (inputs.kitApiMd) {
      const file = resolveWithin(root, inputs.kitApiMd);
      checks.kitApiMd = collaboration.compareKitApiMarkdown(
        manifest,
        fs.readFileSync(file, "utf8"),
        inputs.kitApiMd,
        { strict: has(allArgs, "--strict") },
      );
    }
  } catch (error) {
    if (has(allArgs, "--json")) printJson({ ok: false, errors: [{ code: "C000", path: "$", message: error.message }] });
    else console.error(`契约差异检查失败：${error.message}`);
    return 1;
  }
  const errors = Object.entries(checks).flatMap(([source, result]) => result.errors.map((item) => ({ source, ...item })));
  const warnings = Object.entries(checks).flatMap(([source, result]) => result.warnings.map((item) => ({ source, ...item })));
  const blockingWarnings = warnings.filter((item) => item.code !== "C113");
  const strictFailed = has(allArgs, "--strict") && blockingWarnings.length > 0;
  const result = {
    ok: errors.length === 0 && !strictFailed,
    contractId: loaded.contract.contractId,
    checks,
    errors,
    warnings,
    summary: { errors: errors.length, warnings: warnings.length, blockingWarnings: blockingWarnings.length },
  };
  if (has(allArgs, "--json")) printJson(result);
  else {
    console.log(result.ok ? "✅ 前后端/OpenAPI/权限契约无阻断差异" : "❌ 契约存在阻断差异");
    for (const item of errors) console.error(`  [${item.source}/${item.code}] ${item.path}: ${item.message}`);
    for (const item of warnings) console.log(`  [${item.source}/${item.code}] ${item.path}: ${item.message}`);
    console.log(`汇总：${errors.length} error，${warnings.length} warning`);
  }
  return result.ok ? 0 : 1;
}

function commandFix(args) {
  const [subcommand = "plan", ...rest] = args;
  if (!["plan", "apply"].includes(subcommand)) {
    console.error(`未知 fix 子命令：${subcommand}`);
    return 1;
  }
  const root = targetRoot(rest);
  const valueOptions = new Set(["--target", "--rules", "--plan-hash"]);
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    if (valueOptions.has(rest[index])) { index += 1; continue; }
    if (!rest[index].startsWith("-")) positionals.push(rest[index]);
  }
  const ruleValue = option(rest, "--rules");
  const rules = ruleValue ? ruleValue.split(",").map((value) => value.trim()).filter(Boolean) : undefined;
  let plan;
  try {
    plan = safeFix.buildFixPlan(root, { scanRel: positionals[0], rules });
  } catch (error) {
    console.error(`无法建立安全修复计划：${error.message}`);
    return 1;
  }
  if (!plan.ok) {
    if (has(rest, "--json")) printJson(plan);
    else console.error(`只允许安全自动修复 ${plan.safeRules.join("/")}；不支持：${plan.unsupported.join(", ")}`);
    return 1;
  }
  if (subcommand === "plan") {
    const output = safeFix.publicFixPlan(plan);
    if (has(rest, "--json")) printJson(output);
    else {
      console.log(`安全修复预览：${output.actions.length} 个文件，${output.selected} 个选中问题，${output.manual.length} 个人工项`);
      for (const action of output.actions) for (const edit of action.edits) console.log(`  ${edit.rule} ${action.rel}:${edit.line} ${edit.before} → ${edit.after}`);
      for (const item of output.manual) console.log(`  人工 ${item.rule} ${item.file}:${item.line} — ${item.reason}`);
      console.log(`planHash: ${output.planHash}`);
      console.log(`复扫报告：${output.reportRel}`);
    }
    return 0;
  }
  const result = safeFix.applyFixPlan(plan, {
    confirm: has(rest, "--confirm"),
    planHash: option(rest, "--plan-hash"),
  });
  if (has(rest, "--json")) printJson(result);
  else if (!result.ok) console.error(`安全修复零写入：${result.reason}${result.expectedPlanHash ? `；当前 planHash=${result.expectedPlanHash}` : ""}`);
  else console.log(`✅ 已修改 ${result.applied.length} 个文件并强制复扫；remaining=${result.closure.remaining}，报告=${result.reportRel}`);
  return result.ok && result.closure.selectedOk ? 0 : result.ok ? 1 : 2;
}

function commandDb(args) {
  const [subcommand = "preview", contractArg, ...rest] = args;
  const allArgs = contractArg === undefined ? rest : [contractArg, ...rest];
  const root = targetRoot(allArgs);
  if (subcommand !== "preview") {
    console.error(`未知 db 子命令：${subcommand}（当前只支持 preview）`);
    return 1;
  }
  if (!contractArg || contractArg.startsWith("-")) {
    console.error("db preview 需要契约文件路径");
    return 1;
  }
  const loaded = loadContract(contractArg, { projectRoot: root });
  if (!loaded.ok) {
    if (has(allArgs, "--json")) printJson({ ok: false, errors: loaded.errors });
    else for (const error of loaded.errors) console.error(`${error.path}: ${error.message}`);
    return 1;
  }
  const migrationSql = codegen.renderMigration(loaded.contract);
  const migrationFile = codegen.migrationFileBase(loaded.contract);
  const isAlter = Boolean(loaded.contract.alter);
  const output = {
    ok: true,
    contractId: loaded.contract.contractId,
    migrationFile,
    migrationKind: isAlter ? "ALTER" : "CREATE",
    database: loaded.contract.database,
    migrationSql,
    indexes: loaded.contract.indexes || [],
  };
  if (has(allArgs, "--json")) printJson(output);
  else {
    console.log(`DDL 预览（${output.migrationKind}）— ${output.contractId} [${output.database}]`);
    console.log(`迁移文件：${output.migrationFile}`);
    console.log("");
    console.log(migrationSql);
    if (output.indexes.length > 0) {
      console.log(`\n自定义索引：${output.indexes.length} 个`);
      for (const idx of output.indexes) console.log(`  ${idx.unique ? "UNIQUE " : ""}${idx.name} (${idx.columns.join(", ")})`);
    }
    console.log("\n本预览只读；写入仍需通过 codegen plan/apply。");
  }
  return 0;
}

function commandPermissions(args) {
  const [subcommand = "export", contractArg, ...rest] = args;
  const allArgs = contractArg === undefined ? rest : [contractArg, ...rest];
  const root = targetRoot(allArgs);
  if (subcommand !== "export") {
    console.error(`未知 permissions 子命令：${subcommand}（当前只支持 export）`);
    return 1;
  }
  if (!contractArg || contractArg.startsWith("-")) {
    console.error("permissions export 需要契约文件路径");
    return 1;
  }
  const plan = permissionExport.buildPermissionExportPlan(contractArg, {
    projectRoot: root,
    output: option(allArgs, "--output"),
  });
  if (!plan.ok) {
    if (has(allArgs, "--json")) printJson(plan);
    else for (const error of plan.errors) console.error(`${error.path}: ${error.message}`);
    return 1;
  }
  if (!has(allArgs, "--confirm")) {
    const preview = permissionExport.publicPermissionExportPlan(plan);
    if (has(allArgs, "--json")) printJson(preview);
    else {
      console.log(`权限码导出预览：${plan.inventory.rows.length} 个权限码，${plan.action} ${plan.outputRel}`);
      console.log(`planHash: ${plan.planHash}`);
    }
    return 0;
  }
  const result = permissionExport.applyPermissionExportPlan(plan, {
    confirm: true,
    planHash: option(allArgs, "--plan-hash"),
    allowProductionWrites: has(allArgs, "--allow-production-writes"),
  });
  if (has(allArgs, "--json")) printJson(result);
  else if (!result.ok) console.error(`权限码导出零写入：${result.reason}`);
  else console.log(`✅ 已导出 ${result.inventory.rows.length} 个权限码到 ${result.output}`);
  return result.ok ? 0 : 2;
}

function commandCatalog(args) {
  const catalog = require("../lib/project-catalog");
  const [subcommand = "plan", ...rest] = args;
  const root = targetRoot(rest);
  const moduleId = option(rest, "--module");
  if (subcommand === "show") {
    let result;
    if (moduleId) result = catalog.readModuleCatalog(root, moduleId);
    else {
      const file = path.join(root, catalog.CATALOG_ROOT, "project-catalog.json");
      result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    }
    if (!result) {
      console.error(moduleId ? `模块目录快照不存在：${moduleId}` : "项目目录快照不存在");
      return 1;
    }
    printJson(result);
    return 0;
  }
  if (subcommand === "check") {
    if (!moduleId) {
      console.error("catalog check 必须指定 --module；不会隐式全量扫描");
      return 1;
    }
    const result = catalog.checkModuleFreshness(root, moduleId);
    if (has(rest, "--json")) printJson(result);
    else console.log(result.ok ? `✓ ${moduleId} 目录快照新鲜；仅扫描了当前模块` : `✗ ${moduleId} 目录缺失或已过期`);
    return result.ok ? 0 : 1;
  }
  if (!["plan", "apply"].includes(subcommand)) {
    console.error(`未知 catalog 子命令：${subcommand}（支持 plan/apply/show/check）`);
    return 1;
  }
  const plan = catalog.buildCatalogPlan(root, { module: moduleId, full: has(rest, "--full") });
  if (!plan.ok) {
    if (has(rest, "--json")) printJson(plan);
    else for (const item of plan.errors || []) console.error(`${item.path}: ${item.message}`);
    return 1;
  }
  if (subcommand === "plan" || !has(rest, "--confirm")) {
    const preview = catalog.publicCatalogPlan(plan);
    if (has(rest, "--json")) printJson(preview);
    else {
      console.log(`目录预览：${plan.mode}；实际扫描 ${plan.scannedModules.join(", ")}；复用快照 ${plan.reusedModules.join(", ") || "无"}`);
      console.log(`一跳关联：${plan.linkedModules.join(", ") || "无"}；缺失快照：${plan.missingModules.join(", ") || "无"}`);
      console.log(`变更：${JSON.stringify(plan.summary)}；阻断冲突：${plan.diagnostics.errors.length}`);
      console.log(`planHash: ${plan.planHash}`);
    }
    return plan.blocking ? 2 : 0;
  }
  const result = catalog.applyCatalogPlan(plan, {
    confirm: true,
    planHash: option(rest, "--plan-hash"),
    allowProductionWrites: has(rest, "--allow-production-writes"),
  });
  if (has(rest, "--json")) printJson(result);
  else if (result.ok) console.log(`✓ 目录已刷新；实际扫描 ${result.scannedModules.join(", ")}；其他模块只复用快照`);
  else console.error(`✗ 目录零写入：${result.reason || "validation-failed"}`);
  return result.ok ? 0 : 2;
}

function commandContext(args) {
  const [subcommand = "plan", ...rest] = args;
  if (subcommand !== "plan") {
    console.error(`未知 context 子命令：${subcommand}（当前仅支持 plan）`);
    return 1;
  }
  const planner = require("../lib/context-planner");
  const result = planner.buildContextPlan(targetRoot(rest), {
    module: option(rest, "--module"),
    task: option(rest, "--task", ""),
    keywords: option(rest, "--keywords", ""),
    maxFiles: option(rest, "--max-files"),
    maxBytes: option(rest, "--max-bytes"),
    maxHops: option(rest, "--max-hops"),
  });
  if (has(rest, "--json")) printJson(result);
  else if (!result.ok) {
    for (const item of result.errors || []) console.error(`${item.path || item.code}: ${item.message}`);
    if (result.refreshCommand) console.error(`请先执行：${result.refreshCommand}`);
  } else {
    console.log(`上下文包：${result.module}；扫描模块 ${result.scanPolicy.scannedModules.join(", ")}`);
    console.log(`加载一跳快照：${result.scanPolicy.loadedSnapshotModules.join(", ") || "无"}；关联源码目录扫描：否`);
    console.log(`选择 ${result.selection.selectedFiles} 个文件 / ${result.selection.selectedBytes} bytes；contextHash: ${result.contextHash}`);
    for (const file of result.selection.files) console.log(`  ${file.role.padEnd(20)} ${file.rel} (${file.reason})`);
  }
  return result.ok ? 0 : 1;
}

function commandCommit(args) {
  const policy = require("../lib/commit-policy");
  const [subcommand = "validate", ...rest] = args;
  const root = targetRoot(rest);
  let result;
  if (subcommand === "validate") {
    const file = option(rest, "--file");
    const message = option(rest, "--message");
    if (!file && !message) {
      console.error("commit validate 必须提供 --file <commit-msg-file> 或 --message <header>");
      return 1;
    }
    result = file ? policy.validateFile(root, file) : policy.validateMessage(root, message);
  } else if (subcommand === "check") {
    result = policy.validateRange(root, option(rest, "--range"));
  } else if (subcommand === "doctor") result = policy.doctor(root);
  else {
    console.error(`未知 commit 子命令：${subcommand}（支持 validate/check/doctor）`);
    return 1;
  }
  if (has(rest, "--json")) printJson(result);
  else if (result.ok) console.log(`✓ commit ${subcommand} 通过${result.checked !== undefined ? `；检查 ${result.checked} 个提交` : ""}`);
  else {
    for (const item of result.errors || result.invalid || []) {
      const details = item.errors ? item.errors.map((entry) => entry.message).join("；") : item.message;
      console.error(`✗ ${item.sha ? `${item.sha.slice(0, 12)} ` : ""}${details || result.reason}`);
    }
    if (result.installCommand) console.error(`本地启用：${result.installCommand}`);
  }
  return result.ok ? 0 : 1;
}

function help() {
  console.log(`wl-skills-bd v${pkg.version}

用法：wl-skills-bd <command> [options]

  init         安装受管资产；已有未受管同名文件会阻断
  update       按 manifest 增量更新并保护本地修改
  diff         查看包内容、manifest 与当前项目差异
  clean        只清理未被修改的受管文件
  check        检查 manifest 和安装漂移
  validate     执行 B1~B23 快速规则
  doctor       检查 Maven/JDK/质量门禁/租户接入/契约覆盖/环境配置
  codegen      契约驱动生成：validate / plan / apply
  contract     协作契约：show / diff（前端、OpenAPI、权限、kit api.md）
  db           数据库预览：preview（只读 DDL + Expand-Contract）
  permissions  权限码导出：export（生成 kit SYS_PERMISSION_INFO 片段）
  catalog      项目目录：plan / apply / show / check（默认仅当前模块）
  context      精准上下文：plan（当前模块 + 一跳快照，不扫关联源码）
  commit       提交规范：validate / check / doctor
  fix          安全修复：plan / apply（仅 B3/B5，强制复扫）
  config       配置分层（v0.12）：init / migrate / doctor / fix
  troubleshoot 故障排查（v0.12）：错误关键字 → 诊断步骤
  task         任务驱动（v0.13）：只读识别任务类型 → skill+规则子集+安全写链步骤
  test         测试生成（v0.16）：行为契约测试 gen / scenarios（测行为不测镜像）
  mcp          启动 stdio MCP Server                      
  version      输出版本

通用参数：
  --target <dir>  指定项目根目录
  --dry-run       只预览，不写盘
  --json          输出结构化 JSON
  --force         发生安装冲突时备份后覆盖
  --require-complete  codegen apply 时拒绝写入含业务骨架的 draft 契约
  --strict        validate 的 warn 也返回失败
  --quick         validate 跳过设计级慢规则
  --format <type> validate 报告格式：text/json/sarif/markdown
  --output <file> 将 validate/db/permissions 报告写入项目内相对路径

codegen 示例：
  wl-skills-bd codegen validate wl-contract.json
  wl-skills-bd codegen plan wl-contract.json --json
  wl-skills-bd codegen apply wl-contract.json --plan-hash <hash> --confirm [--require-complete]

contract 示例：
  wl-skills-bd contract show wl-contract.json --format markdown
  wl-skills-bd contract diff wl-contract.json --frontend docs/contracts/page.api.md --openapi openapi.json --permissions permissions.json
  wl-skills-bd contract diff wl-contract.json --kitApiMd src/views/mdm/feature/api.md

db 示例：
  wl-skills-bd db preview wl-contract.json

permissions 示例：
  wl-skills-bd permissions export wl-contract.json --output reports/SYS_PERMISSION_INFO.md --json
  wl-skills-bd permissions export wl-contract.json --output reports/SYS_PERMISSION_INFO.md --plan-hash <hash> --confirm

模块目录与上下文示例：
  wl-skills-bd catalog plan --module order
  wl-skills-bd catalog apply --module order --plan-hash <hash> --confirm
  wl-skills-bd context plan --module order --task "增加订单接口" --json
  wl-skills-bd commit check --range origin/main..HEAD

fix 示例：
  wl-skills-bd fix plan src/main --rules B3,B5 --json
  wl-skills-bd fix apply src/main --rules B3,B5 --plan-hash <hash> --confirm

配置分层与多环境（v0.12，详见 standards/25）：

  wl-skills-bd config init [--project <name>] [--module <name>] [--port <n>]
                           [--datasource-type oracle|mysql] [--customer <name>] [--plan-hash <hash>] [--confirm]
    生成标准配置骨架：bootstrap.yml + application.yml + logback + .env.example ×5 + env-matrix.yml + .gitignore

  wl-skills-bd config migrate --to <customer> [--from <customer>] [--plan|--apply] [--plan-hash <hash>] [--confirm]
    客户迁移：生成 .env + K8s ConfigMap/Secret/Deployment ×5 + 迁移报告

  wl-skills-bd config doctor [--probe] [--probe-timeout <ms>] [--target <dir>]
    配置全链路体检 L0~L8（骨架/明文密码/占位符/矩阵/K8s/端口/一致性/受保护环境护栏）
    --probe 开启 DB/Redis/Nacos TCP 连通性探测

  wl-skills-bd config fix [--plan-hash <hash>] [--confirm] [--target <dir>]
    安全修复：明文密码自动改 ${VAR} 占位符 + 复扫验证

  wl-skills-bd troubleshoot "<错误关键字>"   # 故障排查导引
  wl-skills-bd troubleshoot --list            # 列出所有诊断项

配置示例：
  wl-skills-bd config init --project wl-sale --module sale --port 10000 --json
  wl-skills-bd config init --project wl-sale --module sale --port 10000 --plan-hash <hash> --confirm
  wl-skills-bd config migrate --to huaxin --plan
  wl-skills-bd config migrate --to huaxin --apply --plan-hash <hash> --confirm
  wl-skills-bd config doctor --probe
  wl-skills-bd config fix --json
  wl-skills-bd config fix --plan-hash <hash> --confirm
  wl-skills-bd troubleshoot "Communications link failure"

任务驱动（v0.13，精准触发 + 统一安全写链）：

  wl-skills-bd task --list                              # 列出 8 种任务类型
  wl-skills-bd task "加个查询接口"                       # 自然语言识别任务 → skill/规则/步骤
  wl-skills-bd task "加字段落库"                         # 识别为 add-field
  wl-skills-bd task "改空指针bug"                        # 识别为 fix-bug
  wl-skills-bd task --type add-api                     # 输出契约增量与验证步骤
  wl-skills-bd task --type add-field --target-file <file> # 输出目标相关步骤；不直接写文件

任务类型：new-service / add-api / add-field / add-business-cmd / fix-bug / refactor / audit / config-op
`);
}

function commandTest(args) {
  const [subcommand = "gen", contractArg, ...rest] = args;
  const allArgs = contractArg === undefined ? rest : [contractArg, ...rest];
  const root = targetRoot(allArgs);
  if (subcommand === "gen") {
    if (!contractArg || contractArg.startsWith("-")) {
      console.error("test gen 需要契约文件路径");
      return 1;
    }
    const testCodegen = require("../lib/test-codegen");
    const result = testCodegen.generateServiceTest(contractArg, { projectRoot: root });
    if (!result.ok) {
      if (has(allArgs, "--json")) printJson(result);
      else for (const e of result.errors) console.error(`${e.path}: ${e.message}`);
      return 1;
    }
    if (has(allArgs, "--output")) {
      const out = option(allArgs, "--output");
      const dest = resolveWithin(root, out);
      require("fs").mkdirSync(require("path").dirname(dest), { recursive: true });
      require("fs").writeFileSync(dest, result.content, "utf8");
      if (has(allArgs, "--json")) printJson(result);
      else console.log(`✅ 已生成 ${result.scenarioCount} 个测试场景到 ${out}`);
    } else if (has(allArgs, "--json")) {
      printJson(result);
    } else {
      console.log(`✅ ${result.scenarioCount} 个测试场景（含 smoke + 业务行为契约）：`);
      console.log(result.content);
    }
    return 0;
  }
  if (subcommand === "scenarios") {
    if (!contractArg || contractArg.startsWith("-")) {
      console.error("test scenarios 需要契约文件路径");
      return 1;
    }
    const { loadContract } = require("../lib/contract");
    const testCodegen = require("../lib/test-codegen");
    const loaded = loadContract(contractArg, { projectRoot: root });
    if (!loaded.ok) { for (const e of loaded.errors) console.error(`${e.path}: ${e.message}`); return 1; }
    const ops = loaded.contract.customOperations || [];
    if (ops.length === 0) { console.log("契约无 customOperations，只有标准 CRUD smoke 测试"); return 0; }
    console.log(`业务行为契约测试场景（${ops.length} 个操作）：`);
    for (const op of ops) {
      const scenarios = testCodegen.buildTestScenarios(op, loaded.contract);
      console.log(`  ${op.name}（${op.kind}）：${scenarios.length} 个场景`);
      for (const sc of scenarios) console.log(`    - ${sc.id}：${sc.displayName}`);
    }
    return 0;
  }
  console.error(`未知 test 子命令：${subcommand}（支持 gen / scenarios）`);
  return 1;
}

function commandTask(args) {
  const taskRouter = require("../lib/task-router");

  // --list 列出所有任务类型
  if (has(args, "--list")) {
    const list = taskRouter.listTasks();
    console.log("任务类型（task-driven 精准触发）：");
    for (const t of list) {
      console.log(`  ${t.id.padEnd(18)} ${t.name}（${t.mode}，${t.ruleCount} 规则，${t.skillCount} skill${t.requiresContract ? "，需契约" : ""}）`);
      console.log(`                     触发词示例：${t.triggerExamples.join("、")}`);
    }
    console.log("\n用法：wl-skills-bd task \"<自然语言描述>\"        # 自动识别任务");
    console.log("      wl-skills-bd task --type add-api                # 指定类型输出安全执行步骤");
    return 0;
  }

  const taskType = option(args, "--type");
  const keyword = args.find((a) => !a.startsWith("-"));

  // 模式 1：--type 指定类型并输出统一安全写链。
  if (taskType) {
    const task = taskRouter.getTask(taskType);
    if (!task) {
      console.error(`未知任务类型：${taskType}（--list 查看全部）`);
      return 1;
    }
    if (has(args, "--apply")) {
      console.error("task 是只读指挥层，不直接写代码；请按计划使用 codegen plan/apply（planHash + --confirm）或 safe-fix/config 的确认链。");
      return 1;
    }
    // 默认：输出任务计划
    console.log(taskRouter.formatTaskPlan(task, { targetFile: option(args, "--target-file") }));
    return 0;
  }

  // 模式 2：自然语言识别
  if (!keyword) {
    console.error('用法：wl-skills-bd task "<描述>" 或 --type <id> 或 --list');
    return 1;
  }
  const detected = taskRouter.detectTask(keyword);
  if (!detected) {
    console.log(`未识别任务意图："${keyword}"`);
    console.log("可用任务类型：wl-skills-bd task --list");
    return 1;
  }
  console.log(taskRouter.formatTaskPlan(detected.task));
  if (detected.candidates.length > 1) {
    console.log("\n其他候选：");
    for (const c of detected.candidates.slice(1)) console.log(`  ${c.id}（${c.score}分）：${c.name}`);
  }
  return 0;
}

function commandConfig(args) {
  const [subcommand = "help", ...rest] = args;
  const root = targetRoot(rest);
  if (subcommand === "init") return commandConfigInit(rest, root);
  if (subcommand === "migrate") return commandConfigMigrate(rest, root);
  if (subcommand === "doctor") return commandConfigDoctor(rest, root);
  if (subcommand === "fix") return commandConfigFix(rest, root);
  console.error(`未知 config 子命令：${subcommand}（支持 init/migrate/doctor/fix）`);
  return 1;
}

function commandConfigInit(args, root) {
  const configInit = require("../lib/config-init");
  const plan = configInit.buildInitPlan(root, {
    project: option(args, "--project"),
    module: option(args, "--module"),
    port: option(args, "--port") ? Number(option(args, "--port")) : undefined,
    datasourceType: option(args, "--datasource-type") || option(args, "--datasource"),
    customer: option(args, "--customer"),
    overwrite: has(args, "--overwrite"),
  });
  if (has(args, "--dry-run") || !has(args, "--confirm")) {
    printJson(plan);
    return 0;
  }
  const result = configInit.applyInitPlan(plan, {
    projectRoot: root,
    confirm: has(args, "--confirm"),
    planHash: option(args, "--plan-hash"),
    allowProductionWrites: has(args, "--allow-production-writes"),
    dryRun: has(args, "--dry-run"),
  });
  if (has(args, "--json")) printJson(result);
  else if (!result.ok) {
    console.error(`❌ config init 失败：${result.reason || "未知"}`);
    return 1;
  } else {
    console.log(`✅ config init 完成：${result.applied.filter((a) => a.result === "created").length} 创建 / ${result.applied.filter((a) => a.result === "exists-skipped").length} 跳过`);
    for (const a of result.applied) console.log(`  ${a.result === "created" ? "+" : a.result === "appended" ? "~" : "="} ${a.rel}`);
    console.log("\n下一步：编辑 .wl-skills-bd/env-matrix.yml 填充实际客户配置，运行 config doctor 体检");
  }
  return result.ok ? 0 : 1;
}

function commandConfigMigrate(args, root) {
  const envMatrix = require("../lib/env-matrix");
  const to = option(args, "--to");
  if (!to) {
    console.error("config migrate 需要 --to <customer>");
    return 1;
  }
  const plan = envMatrix.buildMigrationPlan(root, {
    to,
    from: option(args, "--from"),
  });
  if (!plan.ok) {
    if (has(args, "--json")) printJson(plan);
    else console.error(`❌ config migrate 失败：${plan.reason}${plan.customer ? "（" + plan.customer + "）" : ""}`);
    return 1;
  }
  const publicPlan = envMatrix.publicMigrationPlan(plan);
  if (has(args, "--plan") || !has(args, "--apply")) {
    if (has(args, "--json")) printJson(publicPlan);
    else {
      console.log(`配置迁移：${plan.from} → ${plan.to}`);
      console.log(`差异：${plan.diffs.length} 项`);
      console.log(`生成：${plan.actions.length} 个文件（.env ×5 + K8s ×15 + 报告 + 矩阵更新）`);
      console.log(`planHash: ${plan.planHash}`);
      console.log("\n确认后执行：");
      console.log(`  wl-skills-bd config migrate --to ${plan.to} --apply --plan-hash ${plan.planHash} --confirm`);
    }
    return 0;
  }
  const result = envMatrix.applyMigrationPlan(plan, {
    projectRoot: root,
    confirm: has(args, "--confirm"),
    planHash: option(args, "--plan-hash"),
    allowProductionWrites: has(args, "--allow-production-writes"),
  });
  if (has(args, "--json")) printJson(result);
  else if (!result.ok) {
    console.error(`❌ config migrate apply 失败：${result.reason}`);
    return 1;
  } else {
    console.log(`✅ config migrate 完成：${plan.from} → ${plan.to}，生成 ${result.applied.length} 个文件`);
    console.log("\n下一步：");
    console.log("  1. 填充 .env.{to}.{env} 的实际密码（从 K8s Secret 获取）");
    console.log("  2. wl-skills-bd config doctor --probe（连通性探测）");
    console.log("  3. 更新 Nacos {to} namespace 的配置");
  }
  return result.ok ? 0 : 1;
}

function commandConfigDoctor(args, root) {
  const { runConfigDoctor } = require("../lib/config-doctor");
  const result = runConfigDoctor(root, {
    probe: has(args, "--probe"),
    probeTimeoutMs: option(args, "--probe-timeout") ? Number(option(args, "--probe-timeout")) : 3000,
  });
  if (has(args, "--json")) printJson(result);
  else {
    for (const c of result.checks) {
      const mark = c.ok ? "✅" : (c.severity === "warn" ? "⚠️ " : "❌");
      console.log(`${mark} ${c.id}: ${c.detail}`);
      if (!c.ok && c.fix) console.log(`   → ${c.fix}`);
    }
    console.log(`\n汇总：${result.summary.ok}/${result.summary.total} 通过，${result.summary.error} 错误`);
  }
  return result.ok ? 0 : 1;
}

function commandConfigFix(args, root) {
  const configFix = require("../lib/config-fix");
  const plan = configFix.buildFixPlan(root);
  if (has(args, "--plan") || !has(args, "--confirm")) {
    if (has(args, "--json")) printJson(plan);
    else {
      console.log(`config fix 预览：${plan.summary.total} 处明文敏感信息，可修复 ${plan.summary.fixed}`);
      for (const a of plan.actions) console.log(`  ${a.file}: ${a.fixed}/${a.total}`);
      console.log(`planHash: ${plan.planHash}`);
    }
    return 0;
  }
  const result = configFix.applyFixPlan(plan, {
    projectRoot: root,
    confirm: true,
    planHash: option(args, "--plan-hash"),
    allowProductionWrites: has(args, "--allow-production-writes"),
  });
  if (has(args, "--json")) printJson(result);
  else if (!result.ok) {
    const remaining = result.closure && Number.isInteger(result.closure.remaining)
      ? `，剩余 ${result.closure.remaining} 处`
      : "";
    console.error(`❌ config fix 零写入：${result.reason || "closure-failed"}${remaining}`);
    return 1;
  } else {
    console.log(`✅ config fix 完成：修复 ${result.closure.fixed} 处，剩余 ${result.closure.remaining} 处`);
  }
  return result.ok ? 0 : 1;
}

function commandTroubleshoot(args) {
  const ts = require("../lib/troubleshoot");
  if (has(args, "--list")) {
    const list = ts.listAllDiagnostics();
    console.log("故障诊断项：");
    for (const d of list) console.log(`  ${d.id}: ${d.title}（关键字：${d.keywords.join("、")}…）`);
    return 0;
  }
  const keyword = args.find((a) => !a.startsWith("-"));
  if (!keyword) {
    console.error('用法：wl-skills-bd troubleshoot "<错误关键字>"  或  wl-skills-bd troubleshoot --list');
    return 1;
  }
  const result = ts.troubleshoot(keyword);
  console.log(result.output);
  return result.ok ? 0 : 1;
}

function main(argv = process.argv.slice(2)) {
  const [command = "help", ...args] = argv;
  if (["help", "--help", "-h"].includes(command)) { help(); return 0; }
  if (["version", "--version", "-v"].includes(command)) { console.log(pkg.version); return 0; }
  if (["init", "update", "diff"].includes(command)) return commandInstall(command, args);
  if (command === "clean") return commandClean(args);
  if (command === "check") return commandCheck(args);
  if (command === "validate") return commandValidate(args);
  if (command === "doctor") return commandDoctor(args);
  if (command === "codegen") return commandCodegen(args);
  if (command === "contract") return commandContract(args);
  if (command === "db") return commandDb(args);
  if (command === "permissions") return commandPermissions(args);
  if (command === "catalog") return commandCatalog(args);
  if (command === "context") return commandContext(args);
  if (command === "commit") return commandCommit(args);
  if (command === "fix") return commandFix(args);
  if (command === "config") return commandConfig(args);
  if (command === "troubleshoot") return commandTroubleshoot(args);
  if (command === "task") return commandTask(args);
  if (command === "test") return commandTest(args);
  if (command === "mcp") { require("../mcp/server"); return 0; }
  console.error(`未知命令：${command}`);
  help();
  return 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
