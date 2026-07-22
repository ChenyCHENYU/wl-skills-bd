#!/usr/bin/env node
/**
 * verify-version.js — wl-skills-bd 版本与计数一致性自检
 *
 * 校验 package.json#version 是否同步到所有应含版本的位置，
 * 以及 standards 计数 / Skill 计数 / npm files 数组的一致性。
 * 对标 wl-skills-kit/scripts/verify-version.js，适配 bd 结构。
 *
 * 用法：node scripts/verify-version.js   exit 非0表示有违规
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PKG = require(path.join(ROOT, "package.json"));
const VERSION = PKG.version;

const errors = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function verifyNoTrailingWhitespace(current) {
  const stat = fs.statSync(current);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(current)) verifyNoTrailingWhitespace(path.join(current, entry));
    return;
  }
  if (!/\.(?:md|json|ya?ml|tmpl|xml|java|js)$/i.test(current)) return;
  const lines = fs.readFileSync(current, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      errors.push(`${path.relative(ROOT, current)}:${index + 1}: 禁止行尾空白，安装后会破坏 git diff --check`);
    }
  });
}

verifyNoTrailingWhitespace(path.join(ROOT, "files"));
verifyNoTrailingWhitespace(path.join(ROOT, "README.md"));
verifyNoTrailingWhitespace(path.join(ROOT, "CHANGELOG.md"));

// ─── 版本一致性 ─────────────────────────────────────────────────────────

function checkVersionMatch(file, regex, label) {
  let content;
  try {
    content = read(file);
  } catch (e) {
    errors.push(`${file}: 读取失败 - ${e.message}`);
    return;
  }
  const matches = content.match(regex);
  if (!matches || matches.length === 0) {
    warnings.push(`${file}: ${label} - 未匹配 ${regex}`);
    return;
  }
  for (const m of matches) {
    const v = (m.match(/v?(\d+\.\d+\.\d+)/) || [])[1];
    if (!v) {
      errors.push(`${file}: ${label} 版本号解析失败 "${m}"`);
      continue;
    }
    if (v !== VERSION) {
      errors.push(`${file}: ${label} 版本不一致 (${v} vs ${VERSION}) — "${m}"`);
    }
  }
}

// README 徽章（兼容多种格式：status-vX、status-skeleton%20vX）
checkVersionMatch(
  "README.md",
  /status(?:-skeleton)?[%-]v\d+\.\d+\.\d+/,
  "README 徽章",
);
// standards/index.md 版本声明
checkVersionMatch(
  "files/.github/standards/index.md",
  /\*\*版本\*\*：v\d+\.\d+\.\d+/,
  "standards/index.md 版本",
);

// package.json#description
const descMatch = (PKG.description || "").match(/v(\d+\.\d+\.\d+)/);
if (!descMatch) {
  warnings.push("package.json#description: 未含 vX.Y.Z（非阻断）");
} else if (descMatch[1] !== VERSION) {
  errors.push(
    `package.json#description: 版本不一致 (${descMatch[1]} vs ${VERSION})`,
  );
}

if (!exists("package-lock.json")) {
  errors.push("package-lock.json: 文件缺失");
} else {
  try {
    const lock = JSON.parse(read("package-lock.json"));
    if (lock.version !== VERSION || lock.packages?.[""]?.version !== VERSION) {
      errors.push(`package-lock.json: 根版本不一致 (${lock.version}/${lock.packages?.[""]?.version} vs ${VERSION})`);
    }
  } catch (error) {
    errors.push(`package-lock.json: JSON 解析失败 - ${error.message}`);
  }
}

const changelogVersion = (read("CHANGELOG.md").match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1];
if (changelogVersion !== VERSION) {
  errors.push(`CHANGELOG.md: 最新版本不一致 (${changelogVersion || "missing"} vs ${VERSION})`);
}

// ─── standards 计数一致性 ────────────────────────────────────────────────

// 实际 standards 文件数（NN-*.md，排除 index.md）
const STANDARDS_DIR = path.join(ROOT, "files", ".github", "standards");
const standardFiles = fs
  .readdirSync(STANDARDS_DIR)
  .filter((f) => /^\d{2}-.*\.md$/.test(f));
const standardsCount = standardFiles.length;

// index.md 声明的计数
const indexContent = read("files/.github/standards/index.md");
const indexCountMatch = indexContent.match(/##\s*(\d+)\s*条后端规范清单/);
if (!indexCountMatch) {
  errors.push("standards/index.md: 未找到 'N 条后端规范清单' 标题");
} else {
  const declared = parseInt(indexCountMatch[1], 10);
  if (declared !== standardsCount) {
    errors.push(
      `standards/index.md: 声明 ${declared} 条，实际文件 ${standardsCount} 个（${standardFiles.join(", ")}）`,
    );
  }
}

// index.md 表格行数应与文件数一致（格式：| 01   | `01-toolchain.md` |）
const indexTableRows = (indexContent.match(/^\|\s*\d{2}\s*\|/gm) || []).length;
if (indexTableRows !== standardsCount) {
  errors.push(
    `standards/index.md: 表格 ${indexTableRows} 行 vs 实际文件 ${standardsCount} 个`,
  );
}

// ─── Skill 计数一致性 ───────────────────────────────────────────────────

// _registry.md 中 SKILL.md 引用（格式：[`core/xxx`](core/xxx/SKILL.md)）
const registry = read("files/.github/skills/_registry.md");
const skillRefs = registry.match(/\]\([\w./-]+\/SKILL\.md\)/g) || [];
const skillCount = skillRefs.length;
for (const ref of skillRefs) {
  const rel = ref.slice(2, -1);
  if (!exists(`files/.github/skills/${rel}`)) {
    errors.push(`skills/_registry.md: 引用不存在 ${rel}`);
  }
}

// README 中的 Skill 数描述
const readmeContent = read("README.md");
const readmeSkillMatches = readmeContent.match(/(\d+)\s*个核心 Skill/g) || [];
for (const m of readmeSkillMatches) {
  const n = parseInt(m.match(/(\d+)/)[1], 10);
  if (n !== skillCount) {
    errors.push(`README.md: '${m}' 与 _registry.md (${skillCount}) 不一致`);
  }
}

// ─── npm files 数组完整性 ───────────────────────────────────────────────
// package.json#files 是数组如 ["bin", "files", "lib"]，校验前缀匹配
const pkgFiles = PKG.files || [];
const REQUIRED_FILES_DIRS = ["bin", "files"];
for (const dir of REQUIRED_FILES_DIRS) {
  const ok = pkgFiles.some((f) => f === dir || f === dir + "/");
  if (!ok) {
    errors.push(`package.json#files: 缺少 "${dir}" — 发布后 require 将失败`);
  }
}

// lib/ 下若有文件则必须纳入 files
if (exists("lib")) {
  const libOk = pkgFiles.some((f) => f === "lib" || f === "lib/");
  if (!libOk) {
    errors.push("package.json#files: 缺少 'lib/' — 发布后 require be-rules 将失败");
  }
}

// mcp/ 下有文件则必须纳入 files
if (exists("mcp")) {
  const mcpOk = pkgFiles.some((f) => f === "mcp" || f === "mcp/");
  if (!mcpOk) {
    errors.push("package.json#files: 缺少 'mcp/' — 发布后 MCP server 找不到");
  }
}

// ─── MCP 工具一致性 ─────────────────────────────────────────────────────
// registry.js 工具集合是对外契约；数量和名称漂移必须阻断。
let mcpToolCount = 0;
if (exists("mcp/registry.js")) {
  try {
    const { TOOLS } = require(path.join(ROOT, "mcp", "registry"));
    const expectedTools = [
      "wls_be_validate",
      "wls_be_doctor",
      "wls_be_codegen",
      "wls_be_contract",
      "wls_be_safe_fix",
      "wls_be_standards",
      "wls_be_templates",
      "wls_be_db_preview",
      "wls_be_export_permissions",
      "wls_be_config",
      "wls_be_troubleshoot",
      "wls_be_task",
      "wls_be_catalog",
      "wls_be_context",
      "wls_be_commit",
      "wls_be_test",
    ];
    const actualTools = (TOOLS || []).map((tool) => tool.name);
    mcpToolCount = actualTools.length;
    if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
      errors.push(`mcp/registry.js: 工具集合漂移 (${actualTools.join(", ")})`);
    }
  } catch (e) {
    errors.push(`mcp/registry.js: 加载失败 - ${e.message}`);
  }
}

// ─── 多编辑器适配配置 ───────────────────────────────────────────────────
// init 时复制到业务工程的三套 MCP 配置必须存在且合法
const EDITOR_MCPS = [
  { file: "files/.cursor/mcp.json", key: "mcpServers", name: "Cursor" },
  { file: "files/.vscode/mcp.json", key: "servers", name: "VS Code" },
  { file: "files/.kiro/settings/mcp.json", key: "mcpServers", name: "Kiro" },
];
for (const e of EDITOR_MCPS) {
  if (!exists(e.file)) {
    errors.push(`${e.file}: 多编辑器 ${e.name} MCP 配置缺失`);
    continue;
  }
  try {
    const cfg = JSON.parse(read(e.file));
    if (!cfg[e.key] || !cfg[e.key]["wl-skills-bd"]) {
      errors.push(`${e.file}: 缺少 ${e.key}.wl-skills-bd 配置`);
    }
  } catch (err) {
    errors.push(`${e.file}: JSON 格式错误 - ${err.message}`);
  }
}

// ─── Java 模板完整性 ────────────────────────────────────────────────────
const TEMPLATES = [
  "Entity.java.tmpl",
  "CreateDTO.java.tmpl",
  "UpdateDTO.java.tmpl",
  "PageDTO.java.tmpl",
  "VO.java.tmpl",
  "PageVO.java.tmpl",
  "Controller.java.tmpl",
  "Service.java.tmpl",
  "Mapper.java.tmpl",
  "Mapper.xml.tmpl",
  "Migration.sql.tmpl",
  "Rollback.md.tmpl",
  "ServiceTest.java.tmpl",
  "ControllerTest.java.tmpl",
  "OperationRequestDTO.java.tmpl",
  "DdlPreview.md.tmpl",
];
const tmplDir = path.join(ROOT, "files", ".github", "templates");
const actualTemplates = fs.readdirSync(tmplDir).filter((file) => file.endsWith(".tmpl"));
if (actualTemplates.length !== TEMPLATES.length) {
  errors.push(`files/.github/templates: 期望 ${TEMPLATES.length} 个模板，实际 ${actualTemplates.length} 个`);
}
for (const t of TEMPLATES) {
  if (!fs.existsSync(path.join(tmplDir, t))) {
    errors.push(`files/.github/templates/${t}: 代码模板缺失`);
  }
}

// ─── 机器配置单一数据源 ────────────────────────────────────────────────
function readJson(rel) {
  try {
    return JSON.parse(read(rel));
  } catch (error) {
    errors.push(`${rel}: JSON 解析失败 - ${error.message}`);
    return null;
  }
}

const machineConfig = readJson("files/.wl-skills-bd/config.json");
const compatibility = readJson("files/.wl-skills-bd/compatibility.json");
const ruleCatalog = readJson("files/.wl-skills-bd/rules/catalog.json");
if (machineConfig && !exists(`files/.wl-skills-bd/profiles/${machineConfig.defaultProfile}.json`)) {
  errors.push(`config.json: defaultProfile ${machineConfig.defaultProfile} 不存在`);
}
if (compatibility && (!Array.isArray(compatibility.verified) || compatibility.verified.length === 0)) {
  errors.push("compatibility.json: verified 不能为空");
}
if (ruleCatalog) {
  const ids = new Set();
  for (const rule of ruleCatalog.rules || []) {
    if (!rule.id || ids.has(rule.id)) errors.push(`rules/catalog.json: 重复或空 rule id ${rule.id || "<empty>"}`);
    ids.add(rule.id);
    for (const standard of rule.source || []) {
      if (!standardFiles.some((file) => file.startsWith(`${standard}-`))) {
        errors.push(`rules/catalog.json: ${rule.id} 引用不存在的 standard ${standard}`);
      }
    }
  }
  for (let i = 1; i <= 25; i += 1) {
    if (!ids.has(`B${i}`)) errors.push(`rules/catalog.json: 缺少 B${i}`);
  }
  for (let i = 1; i <= 8; i += 1) {
    if (!ids.has(`J${i}`)) errors.push(`rules/catalog.json: 缺少 J${i}`);
  }
}

// ─── 关键产出文件存在性 ─────────────────────────────────────────────────

const REQUIRED_EXIST = [
  "files/.github/copilot-instructions.md",
  "files/.github/standards/index.md",
  "files/.github/skills/_registry.md",
  "files/.github/skills/_pipeline.md",
  "files/.wl-skills-bd/config.json",
  "files/.wl-skills-bd/compatibility.json",
  "files/.wl-skills-bd/schemas/contract.schema.json",
  "files/.wl-skills-bd/schemas/collaboration-contract.schema.json",
  "files/.wl-skills-bd/schemas/rules-config.schema.json",
  "files/.wl-skills-bd/schemas/catalog-config.schema.json",
  "files/.wl-skills-bd/schemas/module-catalog.schema.json",
  "files/.wl-skills-bd/schemas/project-catalog.schema.json",
  "files/.wl-skills-bd/schemas/profile-local.schema.json",
  "files/.wl-skills-bd/schemas/context-plan.schema.json",
  "files/.githooks/commit-msg",
  "files/.github/guides/frontend-backend-contract.md",
  "files/.github/guides/mcp-workflow.md",
  "files/.github/java-quality/jacoco/README.md",
  "files/.github/java-quality/maven-snippets/quality-profile.xml",
  "files/.github/java-quality/maven-snippets/p3c-legacy-profile.xml",
  "files/.wl-skills-bd/rules/catalog.json",
  "mcp/server.js",
  "CHANGELOG.md",
];
for (const rel of REQUIRED_EXIST) {
  if (!exists(rel)) {
    errors.push(`${rel}: 关键文件缺失`);
  }
}

// ─── 输出 ──────────────────────────────────────────────────────────────

if (warnings.length > 0) {
  console.warn("[verify-version] 警告 " + warnings.length + " 项：");
  for (const w of warnings) console.warn("  ⚠ " + w);
}

if (errors.length > 0) {
  console.error("[verify-version] ✖ 失败 " + errors.length + " 项：");
  for (const e of errors) console.error("  ✖ " + e);
  process.exit(1);
}

  console.log(
    `[verify-version] ✔ v${VERSION} 一致 | standards=${standardsCount} | skills=${skillCount} | templates=${TEMPLATES.length} | mcp=${mcpToolCount} | files 数组完整`,
  );
