"use strict";

const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const { runBeRules } = require("./be-rules");
const { hashJson } = require("./deterministic");
const { hashBuffer, hashFile, normalizeRel, resolveWithin, writeTextAtomic } = require("./manifest");
const { guardResult } = require("./write-guard");

const SAFE_RULES = new Set(["B3", "B5"]);

function eolOf(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function baseColumnsInfo(content) {
  const match = content.match(/<sql\b[^>]*\bid=["']BaseColumns["'][^>]*>([\s\S]*?)<\/sql>/i);
  if (!match || !match[1].trim() || /\$\{|(?:^|[^\w.])\*/.test(match[1])) return null;
  const aliases = new Set([...match[1].matchAll(/\b([A-Za-z_]\w*)\.[A-Za-z_]\w*/g)].map((item) => item[1]));
  return { aliases };
}

function selectBlockAt(content, line) {
  const lines = content.split(/\r?\n/);
  const offset = lines.slice(0, Math.max(0, line - 1)).reduce((sum, value) => sum + value.length + 1, 0);
  const start = content.lastIndexOf("<select", offset);
  const end = content.indexOf("</select>", offset);
  if (start < 0 || end < 0) return null;
  return content.slice(start, end + "</select>".length);
}

function b3Safety(content, issue) {
  const baseColumns = baseColumnsInfo(content);
  if (!baseColumns) return { ok: false, reason: "同文件缺少安全、显式的 BaseColumns SQL 片段" };
  const line = content.split(/\r?\n/)[issue.line - 1] || "";
  const star = line.match(/\bSELECT\s+(?:DISTINCT\s+)?(?:([A-Za-z_]\w*)\.)?\*/i);
  if (!star) return { ok: false, reason: "报告行已漂移，未找到 SELECT [alias.]*" };
  const block = selectBlockAt(content, issue.line);
  const from = block && block.match(/\bFROM\s+(?:[A-Za-z0-9_.`"]+)\s+([A-Za-z_]\w*)\b/i);
  const expectedAlias = star[1] || (from && from[1]);
  if (baseColumns.aliases.size > 0 && (!expectedAlias || [...baseColumns.aliases].some((alias) => alias !== expectedAlias))) {
    return { ok: false, reason: "BaseColumns 别名与 SELECT/FROM 别名不一致" };
  }
  return { ok: true, star };
}

function applyB3(lines, issue, safety, eol) {
  const index = issue.line - 1;
  const before = lines[index];
  const match = safety.star;
  const prefix = before.slice(0, match.index) + match[0].replace(/(?:[A-Za-z_]\w*\.)?\*$/i, "").trimEnd();
  const indent = (before.match(/^\s*/) || [""])[0];
  const after = `${prefix}${eol}${indent}<include refid="BaseColumns"/>${before.slice(match.index + match[0].length)}`;
  lines[index] = after;
  return { rule: "B3", line: issue.line, before: before.trim(), after: after.trim() };
}

function b5Safety(content, issue) {
  if (/import\s+(?:javax|jakarta)\.transaction\.Transactional\s*;/.test(content)) {
    return { ok: false, reason: "存在非 Spring Transactional 导入，不能安全自动合并 rollbackFor" };
  }
  const line = content.split(/\r?\n/)[issue.line - 1] || "";
  if (!/^\s*public\b/.test(line)) return { ok: false, reason: "报告行已漂移，未找到 public 写方法签名" };
  return { ok: true };
}

function applyB5(lines, issue) {
  const index = issue.line - 1;
  const indent = (lines[index].match(/^\s*/) || [""])[0];
  const annotation = `${indent}@Transactional(rollbackFor = Exception.class)`;
  lines.splice(index, 0, annotation);
  return { rule: "B5", line: issue.line, before: lines[index + 1].trim(), after: `${annotation.trim()} ${lines[index + 1].trim()}` };
}

function ensureTransactionalImport(content, eol) {
  const springImport = "import org.springframework.transaction.annotation.Transactional;";
  if (content.includes(springImport)) return content;
  const lines = content.split(/\r?\n/);
  let lastImport = -1;
  for (let index = 0; index < lines.length; index += 1) if (/^import\s+/.test(lines[index])) lastImport = index;
  if (lastImport >= 0) lines.splice(lastImport + 1, 0, springImport);
  else {
    const packageIndex = lines.findIndex((line) => /^package\s+/.test(line));
    if (packageIndex < 0) throw new Error("Java 文件缺少 package 声明，不能安全插入 Transactional import");
    lines.splice(packageIndex + 1, 0, "", springImport);
  }
  return lines.join(eol);
}

function transformFile(content, issues) {
  const eol = eolOf(content);
  const lines = content.split(/\r?\n/);
  const edits = [];
  const manual = [];
  let needsTransactionalImport = false;
  for (const issue of [...issues].sort((a, b) => b.line - a.line || a.rule.localeCompare(b.rule))) {
    if (issue.rule === "B3") {
      const safety = b3Safety(content, issue);
      if (!safety.ok) manual.push({ ...issue, reason: safety.reason });
      else edits.push(applyB3(lines, issue, safety, eol));
    } else if (issue.rule === "B5") {
      const safety = b5Safety(content, issue);
      if (!safety.ok) manual.push({ ...issue, reason: safety.reason });
      else {
        edits.push(applyB5(lines, issue));
        needsTransactionalImport = true;
      }
    }
  }
  let next = lines.join(eol);
  if (needsTransactionalImport) next = ensureTransactionalImport(next, eol);
  return { content: next, edits: edits.sort((a, b) => a.line - b.line), manual };
}

function buildFixPlan(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const requestedRules = options.rules && options.rules.length ? [...new Set(options.rules)] : [...SAFE_RULES];
  const unsupported = requestedRules.filter((rule) => !SAFE_RULES.has(rule));
  if (unsupported.length) {
    return { ok: false, reason: "unsupported-rules", unsupported, safeRules: [...SAFE_RULES].sort(), actions: [], manual: [] };
  }
  const scanRel = options.scanRel ? normalizeRel(options.scanRel) : undefined;
  if (scanRel) resolveWithin(projectRoot, scanRel);
  const before = runBeRules(projectRoot, { scanRel });
  const selected = before.issues.filter((issue) => requestedRules.includes(issue.rule));
  const byFile = new Map();
  for (const issue of selected) {
    if (!byFile.has(issue.file)) byFile.set(issue.file, []);
    byFile.get(issue.file).push(issue);
  }
  const actions = [];
  const manual = [];
  for (const [rel, issues] of [...byFile.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const file = resolveWithin(projectRoot, rel);
    const original = fs.readFileSync(file, "utf8");
    const transformed = transformFile(original, issues);
    manual.push(...transformed.manual.map((item) => ({ ...item, file: rel })));
    if (transformed.content === original) continue;
    actions.push({
      rel,
      file,
      beforeHash: hashBuffer(Buffer.from(original, "utf8")),
      afterHash: hashBuffer(Buffer.from(transformed.content, "utf8")),
      content: transformed.content,
      edits: transformed.edits,
    });
  }
  const hashInput = {
    generatorVersion: pkg.version,
    scanRel: scanRel || null,
    rules: requestedRules.sort(),
    selected: selected.map((item) => ({ fingerprint: item.fingerprint, rule: item.rule })),
    actions: actions.map((item) => ({ rel: item.rel, beforeHash: item.beforeHash, afterHash: item.afterHash })),
    manual: manual.map((item) => ({ fingerprint: item.fingerprint, reason: item.reason })),
  };
  const planHash = hashJson(hashInput);
  return {
    ok: true,
    projectRoot,
    scanRel,
    rules: requestedRules.sort(),
    before,
    selected,
    actions,
    manual,
    planHash,
    reportRel: `reports/FIX_BE_${planHash.slice(0, 12)}.md`,
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function renderReport(plan, after, backupId) {
  const afterFingerprints = new Set(after.issues.map((item) => item.fingerprint));
  const selectedFingerprints = new Set(plan.selected.map((item) => item.fingerprint));
  const fixed = plan.selected.filter((item) => !afterFingerprints.has(item.fingerprint));
  const remaining = after.issues.filter((item) => plan.rules.includes(item.rule));
  const regressions = after.issues.filter((item) => !selectedFingerprints.has(item.fingerprint)
    && !plan.before.issues.some((before) => before.fingerprint === item.fingerprint));
  const rows = plan.actions.flatMap((action) => action.edits.map((edit) => `| ${edit.rule} | ${action.rel}:${edit.line} | ${edit.before.replace(/\|/g, "\\|")} | ${edit.after.replace(/\|/g, "\\|")} |`));
  return {
    fixed,
    remaining,
    regressions,
    content: [
      `# FIX_BE_${plan.planHash.slice(0, 12)}`,
      "",
      `> planHash: \`${plan.planHash}\`  `,
      `> backupId: \`${backupId}\`  `,
      `> 规则：${plan.rules.join(", ")}`,
      "",
      "## 修改清单",
      "",
      "| 规则 | 位置 | 修改前 | 修改后 |",
      "|---|---|---|---|",
      ...(rows.length ? rows : ["| - | - | 无自动修改 | - |"]),
      "",
      "## 复扫矩阵",
      "",
      "| 指标 | 修复前 | 修复后 | 变化 |",
      "|---|---:|---:|---:|",
      `| error | ${plan.before.stats.error} | ${after.stats.error} | ${after.stats.error - plan.before.stats.error} |`,
      `| warn | ${plan.before.stats.warn} | ${after.stats.warn} | ${after.stats.warn - plan.before.stats.warn} |`,
      `| 选中规则残余 | ${plan.selected.length} | ${remaining.length} | ${remaining.length - plan.selected.length} |`,
      "",
      `结论：${remaining.length === 0 && regressions.length === 0 ? "✔ 选中规则修复闭环完成" : `✖ 仍有 ${remaining.length} 个选中规则问题、${regressions.length} 个新增问题`}`,
      "",
      ...(plan.manual.length ? ["## 需人工处理", "", ...plan.manual.map((item) => `- ${item.rule} ${item.file}:${item.line} — ${item.reason}`), ""] : []),
    ].join("\n"),
  };
}

function applyFixPlan(plan, options = {}) {
  if (!plan.ok) return { ok: false, reason: plan.reason, unsupported: plan.unsupported || [], applied: [] };
  if (options.confirm !== true) return { ok: false, reason: "confirm-required", applied: [] };
  if (!options.planHash || options.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [] };
  }
  const guarded = guardResult(plan.projectRoot, options);
  if (guarded) return guarded;
  const fresh = buildFixPlan(plan.projectRoot, { scanRel: plan.scanRel, rules: plan.rules });
  if (!fresh.ok || fresh.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, applied: [] };
  }
  if (fresh.actions.length === 0) return { ok: false, reason: "nothing-safe-to-apply", manual: fresh.manual, applied: [] };
  for (const action of fresh.actions) {
    if (!fs.existsSync(action.file) || hashFile(action.file) !== action.beforeHash) {
      return { ok: false, reason: "plan-changed", expectedPlanHash: buildFixPlan(fresh.projectRoot, { scanRel: fresh.scanRel, rules: fresh.rules }).planHash, applied: [] };
    }
  }

  const backupId = `${timestamp()}-${fresh.planHash.slice(0, 12)}`;
  const backupRoot = resolveWithin(fresh.projectRoot, `.wl-skills-bd/.state/fix-backups/${backupId}`);
  const backups = [];
  try {
    for (const action of fresh.actions) {
      const backupFile = resolveWithin(backupRoot, action.rel);
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
      fs.copyFileSync(action.file, backupFile);
      backups.push({ source: action.file, backup: backupFile });
    }
    for (const action of fresh.actions) writeTextAtomic(action.file, action.content);
  } catch (error) {
    for (const item of backups) fs.copyFileSync(item.backup, item.source);
    return { ok: false, reason: "write-failed-rolled-back", message: error.message, applied: [] };
  }

  const after = runBeRules(fresh.projectRoot, { scanRel: fresh.scanRel });
  let report;
  try {
    report = renderReport(fresh, after, backupId);
    const reportFile = resolveWithin(fresh.projectRoot, fresh.reportRel);
    if (fs.existsSync(reportFile)) {
      const current = fs.readFileSync(reportFile, "utf8");
      if (current !== report.content) throw new Error(`报告已存在且内容不同：${fresh.reportRel}`);
    } else writeTextAtomic(reportFile, report.content);
  } catch (error) {
    try {
      for (const item of backups) fs.copyFileSync(item.backup, item.source);
    } catch (rollbackError) {
      return { ok: false, reason: "report-failed-rollback-failed", message: `${error.message}; rollback: ${rollbackError.message}`, reportRel: fresh.reportRel, applied: [] };
    }
    return { ok: false, reason: "report-failed-rolled-back", message: error.message, reportRel: fresh.reportRel, applied: [] };
  }

  return {
    ok: true,
    state: report.remaining.length === 0 && report.regressions.length === 0 ? "completed" : "completed-with-remaining",
    planHash: fresh.planHash,
    backupId,
    reportRel: fresh.reportRel,
    applied: fresh.actions.map((action) => ({ rel: action.rel, edits: action.edits })),
    closure: {
      before: fresh.before.stats,
      after: after.stats,
      fixed: report.fixed.length,
      remaining: report.remaining.length,
      regressions: report.regressions.length,
      selectedOk: report.remaining.length === 0 && report.regressions.length === 0,
      projectOk: after.stats.error === 0,
    },
  };
}

function publicFixPlan(plan) {
  if (!plan.ok) return plan;
  return {
    ok: true,
    mode: "preview",
    state: plan.actions.length > 0 ? "ready" : "manual-required",
    planHash: plan.planHash,
    scanRel: plan.scanRel || null,
    rules: plan.rules,
    reportRel: plan.reportRel,
    before: plan.before.stats,
    selected: plan.selected.length,
    actions: plan.actions.map((action) => ({ rel: action.rel, beforeHash: action.beforeHash, afterHash: action.afterHash, edits: action.edits })),
    manual: plan.manual.map((item) => ({ rule: item.rule, file: item.file, line: item.line, reason: item.reason, fingerprint: item.fingerprint })),
  };
}

module.exports = { SAFE_RULES, applyFixPlan, buildFixPlan, publicFixPlan };
