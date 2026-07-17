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

// bin/wl-skills-bd.js 注释里的版本
checkVersionMatch("bin/wl-skills-bd.js", /v\d+\.\d+\.\d+/, "CLI header");
// README 徽章
checkVersionMatch(
  "README.md",
  /status-skeleton%20v\d+\.\d+\.\d+/,
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
// registry.js 注册的 TOOLS 数量应 > 0，且 server.js 可加载
if (exists("mcp/registry.js")) {
  try {
    const { TOOLS } = require(path.join(ROOT, "mcp", "registry"));
    if (!TOOLS || TOOLS.length === 0) {
      errors.push("mcp/registry.js: 未注册任何 MCP 工具");
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
  "DTO.java.tmpl",
  "PageDTO.java.tmpl",
  "VO.java.tmpl",
  "Controller.java.tmpl",
  "Service.java.tmpl",
  "Mapper.java.tmpl",
  "Mapper.xml.tmpl",
];
const tmplDir = path.join(ROOT, "files", ".github", "templates");
for (const t of TEMPLATES) {
  if (!fs.existsSync(path.join(tmplDir, t))) {
    errors.push(`files/.github/templates/${t}: 代码模板缺失`);
  }
}

// ─── 关键产出文件存在性 ─────────────────────────────────────────────────

const REQUIRED_EXIST = [
  "files/.github/copilot-instructions.md",
  "files/.github/standards/index.md",
  "files/.github/skills/_registry.md",
  "files/.github/skills/_pipeline.md",
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
  `[verify-version] ✔ v${VERSION} 一致 | standards=${standardsCount} | skills=${skillCount} | mcp=ok | files 数组完整`,
);
