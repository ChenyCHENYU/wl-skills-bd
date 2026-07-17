"use strict";

/**
 * beRulesTools — MCP 工具：包装 lib/be-rules.js
 *
 * 暴露 wls_be_validate（扫描工程输出 B1~B8 偏差）。
 * 对标 kit 的 mcp/tools/projectTools.js，但后端无需网关，只读扫描。
 */

const path = require("path");
const fs = require("fs");
const { runBeRules } = require("../../lib/be-rules");

const RULE_DESC = {
  B1: "Controller 接口缺 @PreAuthorize（越权风险）",
  B2: "Controller 缺 @ApiOperation（文档缺失）",
  B3: "Mapper XML SELECT 星号",
  B4: "Mapper XML 美元花括号注入",
  B5: "写操作缺 @Transactional",
  B6: "单目录文件 >20",
  B7: "SELECT 缺 COMPANY_ID",
  B8: "裸 RuntimeException",
};

function resolveProjectRoot() {
  return process.env.WL_PROJECT_ROOT || process.cwd();
}

function handleValidate(args) {
  const target = resolveProjectRoot();
  let scanRoot = target;
  if (args.path) {
    scanRoot = path.isAbsolute(args.path) ? args.path : path.join(target, args.path);
  }
  if (!fs.existsSync(scanRoot)) {
    return {
      text: `❌ 扫描路径不存在：${scanRoot}`,
      isError: true,
      structuredContent: { ok: false, error: "path-not-found" },
    };
  }

  const relScan = args.path
    ? path.isAbsolute(args.path)
      ? path.relative(target, args.path) || undefined
      : args.path
    : undefined;

  const { issues, stats } = runBeRules(target, { scanRel: relScan });

  if (issues.length === 0) {
    return {
      text: "✅ 未发现 B1~B8 确定性违规。\n注：本工具覆盖框架级注解/SQL/目录密度；命名/架构分层请配合 Checkstyle + ArchUnit。",
      structuredContent: { ok: true, error: 0, warn: 0, total: 0 },
    };
  }

  // 按规则分组（精简输出，避免 token 爆炸）
  const byRule = {};
  for (const i of issues) {
    if (!byRule[i.rule]) byRule[i.rule] = [];
    byRule[i.rule].push(i);
  }

  const lines = [`扫描：${scanRoot}`, ""];
  for (const rule of Object.keys(byRule).sort()) {
    const list = byRule[rule];
    const sev = list[0].severity;
    const icon = sev === "error" ? "🔴" : "🟡";
    lines.push(`${icon} ${rule} (${list.length} 项) [${sev}] — ${RULE_DESC[rule] || ""}`);
    const show = list.slice(0, 10);
    for (const i of show) {
      const loc = i.line ? `:${i.line}` : "";
      lines.push(`   ${i.file}${loc}`);
    }
    if (list.length > 10) lines.push(`   ... 还有 ${list.length - 10} 项`);
  }
  lines.push("");
  lines.push(`汇总：🔴 ${stats.error} | 🟡 ${stats.warn} | 共 ${stats.total} 项`);

  return {
    text: lines.join("\n"),
    structuredContent: {
      ok: stats.error === 0,
      error: stats.error,
      warn: stats.warn,
      total: stats.total,
      byRule: stats.byRule,
    },
    isError: stats.error > 0,
  };
}

module.exports = {
  handleValidate,
  RULE_DESC,
};
