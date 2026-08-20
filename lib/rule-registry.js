"use strict";

/**
 * rule-registry：规则注册表自检（catalog.json ↔ 实现 ↔ _registry.md）
 *
 * 背景：catalog 由人工维护，曾出现"catalog 登记了 executor 但实现细节漂移无人察觉"、
 * "_registry.md 的 Skill 状态与 catalog 各自表述"的问题。本模块把注册表健康度做成可执行检查：
 *
 * - catalog 自身可解析、ID 唯一、severity/fix 取值合法
 * - executor=be-rules 的规则在 be-rules.js 的扫描输出标识（issue("Bxx")）中真实存在
 * - executor 为 Maven 插件（J 系列）时给出"需项目接线"提示，不冒充已生效
 */

const fs = require("fs");
const path = require("path");

function readText(file) {
  let text = fs.readFileSync(file, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function checkRuleRegistry(packageRoot) {
  const issues = [];
  const catalogFile = path.join(packageRoot, "files", ".wl-skills-bd", "rules", "catalog.json");
  let catalog;
  try {
    catalog = JSON.parse(readText(catalogFile));
  } catch (error) {
    return { ok: false, issues: [{ severity: "error", message: `catalog.json 解析失败：${error.message}` }], summary: { rules: 0 } };
  }

  const seen = new Set();
  const validSeverity = new Set(["error", "warn", "info"]);
  const validFix = new Set(["manual", "suggested", "safe", "safe-conditional", "safe-or-suggested"]);
  for (const rule of catalog.rules || []) {
    if (!rule.id || !/^[BJ]\d+$/.test(rule.id)) {
      issues.push({ severity: "error", message: `规则 ID 非法：${rule.id}` });
      continue;
    }
    if (seen.has(rule.id)) issues.push({ severity: "error", message: `规则 ID 重复登记：${rule.id}` });
    seen.add(rule.id);
    if (rule.severity && !validSeverity.has(rule.severity)) {
      issues.push({ severity: "error", message: `${rule.id} severity 非法：${rule.severity}` });
    }
    if (rule.fix && !validFix.has(rule.fix)) {
      issues.push({ severity: "warn", message: `${rule.id} fix 策略未登记于白名单：${rule.fix}` });
    }
  }

  // executor=be-rules 的 B 规则必须在 be-rules.js 中有 issue 输出标识
  const beRulesFile = path.join(packageRoot, "lib", "be-rules.js");
  if (fs.existsSync(beRulesFile)) {
    const source = readText(beRulesFile);
    for (const rule of catalog.rules || []) {
      if (rule.executor !== "be-rules" || !/^B\d+$/.test(rule.id)) continue;
      const marker = `"${rule.id}"`;
      if (!source.includes(marker)) {
        issues.push({ severity: "error", message: `${rule.id} 声明 executor=be-rules，但 be-rules.js 中没有对应输出标识 ${marker}（幽灵规则）` });
      }
    }
  } else {
    issues.push({ severity: "warn", message: "未找到 lib/be-rules.js，跳过实现核对" });
  }

  // J 系列（外部 Maven 插件）提示性核对：只确认登记了 gate 字段与否，不冒充生效
  const jRules = (catalog.rules || []).filter((r) => /^J\d+$/.test(r.id));
  const jGated = jRules.filter((r) => r.gate === false).length;
  if (jRules.length > 0) {
    issues.push({ severity: "info", message: `J 系列 ${jRules.length} 条依赖项目 pom 接线（其中 ${jGated} 条已标注 gate:false 非硬门）；接线状态由 doctor 的 maven-gates/archunit 体检给出` });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  return {
    ok: errors === 0,
    issues,
    summary: { rules: (catalog.rules || []).length, errors, warns: issues.filter((i) => i.severity === "warn").length },
  };
}

module.exports = { checkRuleRegistry };
