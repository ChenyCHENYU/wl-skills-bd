"use strict";

/**
 * beRulesTools — MCP 工具：包装 lib/be-rules.js
 *
 * 暴露 wls_be_validate（扫描工程输出 B1~B12 偏差）。
 * 对标 kit 的 mcp/tools/projectTools.js，但后端无需网关，只读扫描。
 */

const fs = require("fs");
const { runBeRules } = require("../../lib/be-rules");
const { normalizeRel, resolveWithin } = require("../../lib/manifest");
const { projectRoot } = require("../project-root");

const RULE_DESC = {
  B1: "Controller 接口缺 @PreAuthorize（越权风险）",
  B2: "Controller 缺 @Operation/@ApiOperation（文档缺失）",
  B3: "Mapper XML SELECT 星号",
  B4: "Mapper XML 美元花括号注入",
  B5: "写操作缺 @Transactional",
  B6: "单目录文件 >20",
  B7: "SELECT 缺 COMPANY_ID",
  B8: "裸 RuntimeException",
  B9: "类长度 >500 行（上帝类）",
  B10: "方法长度 >80 行（长方法）",
  B11: "圈复杂度 >10",
  B12: "业务/接口方法缺 Javadoc",
};

function handleValidate(args) {
  const target = projectRoot();
  let scanRoot;
  try {
    scanRoot = args.path ? resolveWithin(target, args.path) : target;
  } catch (error) {
    return { text: `❌ ${error.message}`, isError: true, structuredContent: { ok: false, error: "path-outside-project" } };
  }
  if (!fs.existsSync(scanRoot)) {
    return {
      text: `❌ 扫描路径不存在：${scanRoot}`,
      isError: true,
      structuredContent: { ok: false, error: "path-not-found" },
    };
  }

  const relScan = args.path ? normalizeRel(args.path) : undefined;

  const { issues, suppressed, stats } = runBeRules(target, { scanRel: relScan, quick: args.quick === true });

  if (issues.length === 0) {
    return {
      text: "✅ 未发现 B1~B12 违规。\n注：架构、格式和缺陷仍需配合 ArchUnit/Checkstyle/PMD/SpotBugs/Spotless。",
      structuredContent: { ok: true, ...stats, issues: [], suppressed: suppressed.length },
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
      issues: issues.slice(0, 100),
      suppressed: suppressed.length,
    },
    isError: stats.error > 0,
  };
}

module.exports = {
  handleValidate,
  RULE_DESC,
};
