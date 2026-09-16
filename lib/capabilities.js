"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_OUTPUT_REL = "files/.wl-skills-bd/capabilities.json";

// CLI 命令清单：capabilities.json 的单一数据源之一。
// verify-version.js 会校验每个命令在 bin/wl-skills-bd.js 的 main() 分发中真实存在，
// 修改本清单必须同步 bin 分发与 help()。
const CLI_COMMANDS = [
  { name: "init", summary: "安装受管资产；冲突零写入，--force 备份后覆盖", write: "gated" },
  { name: "update", summary: "按 manifest 增量更新并保护本地修改", write: "gated" },
  { name: "diff", summary: "查看包内容、manifest 与当前项目差异", write: "readonly" },
  { name: "clean", summary: "只清理未被修改的受管文件", write: "gated" },
  { name: "check", summary: "检查 manifest 和安装漂移", write: "readonly" },
  { name: "validate", summary: "执行 B 规则快速审计并输出端点与数据库事实源差异", write: "readonly" },
  { name: "doctor", summary: "环境/JDK/质量门/租户/契约覆盖/配置体检", write: "readonly" },
  { name: "codegen", summary: "契约驱动生成 validate/plan/apply（planHash+确认）", write: "gated" },
  { name: "contract", summary: "契约治理 seed/inspect/migrate/show/diff", write: "gated" },
  { name: "db", summary: "数据库治理 preview/review（三方对账）/drift/executed/ledger/snapshot-template（DDL 只生成不执行）", write: "gated" },
  { name: "permissions", summary: "权限码导出 export（kit 片段）", write: "gated" },
  { name: "catalog", summary: "模块目录 plan/apply/show/check（默认仅当前模块）", write: "gated" },
  { name: "context", summary: "精准上下文 plan（当前模块 + 一跳快照）", write: "readonly" },
  { name: "impact", summary: "字段影响 field（契约/存储/迁移/源码证据）", write: "readonly" },
  { name: "integration", summary: "集成治理 inspect/audit/adapters/plan/apply", write: "gated" },
  { name: "review", summary: "变更审查总控 run/baseline", write: "gated" },
  { name: "commit", summary: "提交规范 validate/check/doctor", write: "readonly" },
  { name: "fix", summary: "分级修复 advise/plan/apply/policy", write: "gated" },
  { name: "config", summary: "配置分层 init/migrate/doctor/fix", write: "gated" },
  { name: "troubleshoot", summary: "错误关键字 → 诊断步骤", write: "readonly" },
  { name: "task", summary: "只读任务路由 → skill+规则子集+安全写链", write: "readonly" },
  { name: "test", summary: "行为契约测试 gen/scenarios", write: "gated" },
  { name: "capabilities", summary: "输出 AI 能力清单（skills/触发词/MCP 工具/CLI 命令）", write: "readonly" },
  { name: "mcp", summary: "启动 stdio MCP Server", write: "launcher" },
];

// 受控写 MCP 工具（planHash/确认链）；其余默认只读。
const MCP_WRITE_TOOLS = new Set([
  "wls_be_codegen",
  "wls_be_contract",
  "wls_be_safe_fix",
  "wls_be_review",
  "wls_be_export_permissions",
  "wls_be_config",
  "wls_be_catalog",
]);

// AI 首次接入的推荐读取顺序；入口文件在目标项目内的安装路径。
const AGENT_BOOTSTRAP = {
  manifest: ".wl-skills-bd/capabilities.json",
  firstCall: "wl-skills-bd capabilities --json 或 MCP wls_be_capabilities",
  readingOrder: [
    ".wl-skills-bd/capabilities.json（机器能力清单：skills 触发词/状态/路径、MCP 工具、CLI 命令）",
    ".github/copilot-instructions.md（统一 AI 入口与技术基线）",
    ".github/skills/_registry.md（触发词 → Skill 路由）",
    ".github/standards/index.md（任务类型 → 必读规范，懒加载）",
  ],
  lazyLoadRules: [
    "不要一次性读取全部 standards；按任务类型只读必需条目",
    "任务路由先调 wls_be_task 或 wl-skills-bd task，再按输出加载 skill/规则子集",
    "大结果使用 response.cursor 续取，不重复注入上下文",
  ],
};

function readFrontmatter(file) {
  const content = fs.readFileSync(file, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result = {};
  let section = null;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (field) {
      const value = field[2].trim();
      result[field[1]] = value;
      section = value === "" ? field[1] : null;
      continue;
    }
    const nested = line.match(/^\s+([a-zA-Z][\w-]*):\s*(.*)$/);
    if (section === "metadata" && nested) {
      result[nested[1]] = nested[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return result;
}

function walkSkillFiles(root) {
  const files = [];
  for (const category of fs.readdirSync(root, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryRoot = path.join(root, category.name);
    for (const skill of fs.readdirSync(categoryRoot, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const file = path.join(categoryRoot, skill.name, "SKILL.md");
      if (fs.existsSync(file)) files.push(file);
    }
  }
  return files.sort();
}

function normalizeSkillStatus(value) {
  if (String(value).includes("✅")) return "implemented";
  if (String(value).includes("部分")) return "partial";
  if (String(value).includes("骨架")) return "skeleton";
  return "unknown";
}

function parseTriggers(value) {
  if (!value) return [];
  return String(value)
    .split(/[、,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeMcpTools(tools) {
  return (tools || []).map((tool) => ({
    name: tool.name,
    description: String(tool.description || "").split("\n")[0],
    write: MCP_WRITE_TOOLS.has(tool.name) ? "gated" : "readonly",
  }));
}

function discoverCapabilities(packageRootInput, options = {}) {
  const packageRoot = path.resolve(packageRootInput);
  const standardsRoot = path.join(packageRoot, "files", ".github", "standards");
  const standardFiles = fs.readdirSync(standardsRoot)
    .filter((file) => /^\d{2}-.+\.md$/.test(file))
    .sort();
  const standardIds = standardFiles.map((file) => file.slice(0, 2));
  const ruleCatalog = JSON.parse(fs.readFileSync(path.join(packageRoot, "files", ".wl-skills-bd", "rules", "catalog.json"), "utf8"));
  const backendRuleIds = ruleCatalog.rules
    .map((rule) => rule.id)
    .filter((id) => /^B\d+$/.test(id))
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
  const skillFiles = walkSkillFiles(path.join(packageRoot, "files", ".github", "skills"));
  const skills = skillFiles.map((file) => {
    const frontmatter = readFrontmatter(file);
    const repoPath = path.relative(packageRoot, path.dirname(file)).replace(/\\/g, "/");
    return {
      name: frontmatter.name,
      path: repoPath,
      installedPath: repoPath.replace(/^files\/\.github\//, ".github/"),
      status: normalizeSkillStatus(frontmatter.status),
      statusLabel: frontmatter.status,
      stage: frontmatter.stage,
      triggers: parseTriggers(frontmatter.triggers),
      risk: frontmatter.risk || null,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const latestRule = backendRuleIds.at(-1) || null;
  const mcpToolItems = normalizeMcpTools(options.mcpTools);
  return {
    schemaVersion: 2,
    kind: "wl-skills-bd-capabilities",
    standards: {
      count: standardIds.length,
      ids: standardIds,
      latest: standardIds.at(-1) || null,
    },
    backendRules: {
      count: backendRuleIds.length,
      ids: backendRuleIds,
      latest: latestRule,
      displayRange: latestRule ? `B1~${latestRule}` : "",
      catalog: ".wl-skills-bd/rules/catalog.json",
    },
    skills: {
      count: skills.length,
      items: skills,
      summary: {
        implemented: skills.filter((skill) => skill.status === "implemented").length,
        partial: skills.filter((skill) => skill.status === "partial").length,
        skeleton: skills.filter((skill) => skill.status === "skeleton").length,
        unknown: skills.filter((skill) => skill.status === "unknown").length,
      },
    },
    mcpTools: {
      count: mcpToolItems.length,
      items: mcpToolItems,
    },
    cliCommands: {
      count: CLI_COMMANDS.length,
      items: CLI_COMMANDS,
    },
    agentBootstrap: AGENT_BOOTSTRAP,
  };
}

function serializeCapabilities(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

module.exports = {
  AGENT_BOOTSTRAP,
  CLI_COMMANDS,
  DEFAULT_OUTPUT_REL,
  MCP_WRITE_TOOLS,
  discoverCapabilities,
  normalizeSkillStatus,
  parseTriggers,
  readFrontmatter,
  serializeCapabilities,
};
