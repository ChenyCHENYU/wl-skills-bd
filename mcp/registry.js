"use strict";

/**
 * registry — MCP 工具注册中心（单一数据源）
 * 对标 wl-skills-kit/mcp/registry.js，精简为后端 3 个工具。
 * 新增工具只改本文件。
 */

const fs = require("fs");
const path = require("path");
const PKG = require("../package.json");
const { handleValidate } = require("./tools/beRulesTools");

const PKG_ROOT = path.resolve(__dirname, "..");

// ─── 工具 1：wls_be_validate（扫描 B1~B8）──────────────────────────────

const validateTool = {
  name: "wls_be_validate",
  description:
    "扫描 Java 后端工程的确定性规范违规（B1~B8）。\n" +
    "B1 Controller缺@PreAuthorize / B2 缺@ApiOperation / B3 SELECT星号 / B4 美元符注入 / " +
    "B5 缺@Transactional / B6 目录文件>20 / B7 缺COMPANY_ID / B8 裸RuntimeException。\n" +
    "有 error 级时 isError=true，供 AI 判断是否阻断。",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "扫描子目录（相对项目根或绝对路径），省略则扫全项目",
      },
    },
    additionalProperties: false,
  },
  handle: handleValidate,
};

// ─── 工具 2：wls_be_standards（查询规范条款）────────────────────────────

const standardsTool = {
  name: "wls_be_standards",
  description:
    "查询 wl-skills-bd 的规范条款清单（18 条 standards）或指定条款内容。\n" +
    "无参返回全部清单；传 id（如 '04'）返回该条款全文。",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "规范编号（01~18），省略则返回清单",
      },
    },
    additionalProperties: false,
  },
  handle(args) {
    const indexDir = path.join(PKG_ROOT, "files", ".github", "standards");
    if (!args.id) {
      const index = fs.readFileSync(path.join(indexDir, "index.md"), "utf8");
      return { text: index.slice(0, 4000) };
    }
    const num = String(args.id).padStart(2, "0");
    const files = fs.readdirSync(indexDir).filter((f) => f.startsWith(num + "-"));
    if (files.length === 0) {
      return {
        text: `❌ 无规范 ${args.id}（应为 01~18）`,
        isError: true,
        structuredContent: { ok: false },
      };
    }
    const content = fs.readFileSync(path.join(indexDir, files[0]), "utf8");
    return { text: content, structuredContent: { ok: true, file: files[0] } };
  },
};

// ─── 工具 3：wls_be_templates（查代码模板）──────────────────────────────

const templatesTool = {
  name: "wls_be_templates",
  description:
    "查 wl-skills-bd 的 Java 代码模板（codegen 标准骨架）。\n" +
    "无参返回模板清单；传 name（如 'Controller'）返回模板全文，供 AI 生成代码时对齐。",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "模板名（Entity/DTO/PageDTO/VO/Controller/Service/Mapper.java/Mapper.xml），省略则返回清单",
      },
    },
    additionalProperties: false,
  },
  handle(args) {
    const tmplDir = path.join(PKG_ROOT, "files", ".github", "templates");
    if (!args.name) {
      const readme = fs.readFileSync(path.join(tmplDir, "README.md"), "utf8");
      return { text: readme };
    }
    const candidates = [
      `${args.name}.java.tmpl`,
      `${args.name}.xml.tmpl`,
      args.name.endsWith(".tmpl") ? args.name : null,
    ].filter(Boolean);
    for (const c of candidates) {
      const fp = path.join(tmplDir, c);
      if (fs.existsSync(fp)) {
        return {
          text: fs.readFileSync(fp, "utf8"),
          structuredContent: { ok: true, file: c },
        };
      }
    }
    return {
      text: `❌ 无模板 ${args.name}（可用：Entity/DTO/PageDTO/VO/Controller/Service/Mapper.java/Mapper.xml）`,
      isError: true,
      structuredContent: { ok: false },
    };
  },
};

// ─── 导出（TOOLS 给 tools/list，HANDLERS 给 tools/call）─────────────────

const HANDLERS = {
  [validateTool.name]: validateTool,
  [standardsTool.name]: standardsTool,
  [templatesTool.name]: templatesTool,
};

const TOOLS = [validateTool, standardsTool, templatesTool].map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

module.exports = { TOOLS, HANDLERS };
