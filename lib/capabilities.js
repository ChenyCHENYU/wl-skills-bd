"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_OUTPUT_REL = "files/.wl-skills-bd/capabilities.json";

// Native dispatcher/help、protocol describe 和分发能力快照使用同一命令目录。
const CLI_COMMANDS = require("./cli-catalog").commandInventory();

// MCP 副作用由真实 registry 定义并通过 tools/list 的 _meta 暴露，勿维护第二份名称名单。
const MCP_WRITE_TOOLS = new Set(require("../mcp/registry").TOOLS
  .filter((tool) => tool._meta["wl/sideEffects"].write === "gated")
  .map((tool) => tool.name));

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
    write: tool._meta?.["wl/sideEffects"]?.write || "unknown",
    sideEffects: tool._meta?.["wl/sideEffects"]?.summary || "副作用未声明",
    annotations: tool.annotations || {},
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
