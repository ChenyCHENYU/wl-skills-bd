"use strict";

/**
 * db-spec：需求文档 ↔ 契约 的表结构一致性闭环（B31）
 *
 * 背景：2026-08-20 事故——32 张表实现时改名（pl_charge→pl_heat_process 等）、
 * 需求文档写的 apply_jugde_status 等字段无实现、pl_slab_main 被现场直接加列，
 * 全程无工具拦截。本模块把“以文档为源头”做成可执行校验：
 *
 * - docs/db-spec/*.json 为需求文档的结构化镜像（从数据库设计文档提取进 git）
 * - naming-waivers.json 登记经审批的改名映射（带理由/审批人/日期），豁免可追溯
 * - B31：文档表/字段 vs 契约逐项对照，未登记豁免的漂移 → error
 *
 * 本模块只读源码与文档，不连接数据库、不执行任何 DDL。
 */

const fs = require("fs");
const path = require("path");

const DB_SPEC_DIR = "docs/db-spec";
const WAIVERS_FILE = ".wl-skills-bd/naming-waivers.json";

function readJsonIfExists(file) {
  try {
    let text = fs.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 收集项目 docs/db-spec/*.json 的全部表定义 */
function loadDbSpec(projectRoot) {
  const specDir = path.join(projectRoot, DB_SPEC_DIR);
  const result = { ok: false, tables: new Map(), files: [], errors: [] };
  if (!fs.existsSync(specDir)) {
    result.errors.push({ code: "NO_SPEC_DIR", message: `未找到 ${DB_SPEC_DIR}/；B31 需要“文档表结构镜像”才能校验源头一致性` });
    return result;
  }
  const entries = fs.readdirSync(specDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"));
  if (entries.length === 0) {
    result.errors.push({ code: "EMPTY_SPEC_DIR", message: `${DB_SPEC_DIR}/ 为空；请从数据库设计文档提取表结构镜像` });
    return result;
  }
  for (const entry of entries) {
    const file = path.join(specDir, entry.name);
    const parsed = readJsonIfExists(file);
    if (!parsed || !Array.isArray(parsed.tables)) {
      result.errors.push({ code: "BAD_SPEC_FILE", message: `${DB_SPEC_DIR}/${entry.name} 缺少 tables 数组` });
      continue;
    }
    result.files.push(entry.name);
    for (const table of parsed.tables) {
      if (!table.name || !Array.isArray(table.fields)) continue;
      result.tables.set(String(table.name).toLowerCase(), {
        name: table.name,
        cname: table.cname || "",
        fields: table.fields.map((f) => ({
          name: String(f.name || f).toLowerCase(),
          cname: typeof f === "object" ? (f.cname || "") : "",
        })),
        source: `${DB_SPEC_DIR}/${entry.name}`,
      });
    }
  }
  result.ok = result.errors.length === 0 && result.tables.size > 0;
  return result;
}

/** 读取命名豁免登记（经审批的改名映射） */
function loadWaivers(projectRoot) {
  const file = path.join(projectRoot, WAIVERS_FILE);
  const parsed = readJsonIfExists(file);
  if (!parsed || !Array.isArray(parsed.waivers)) return { active: new Map(), entries: [] };
  const active = new Map();
  for (const w of parsed.waivers) {
    if (!w || w.status === "retired" || !w.from || !w.to) continue;
    active.set(String(w.from).toLowerCase(), w);
  }
  return { active, entries: parsed.waivers };
}

/** 基线字段集：文档字段 + 该表豁免登记里的字段基线（w.baselineFields 显式声明时） */
function effectiveBaseline(specTable, waiver) {
  if (waiver && Array.isArray(waiver.baselineFields)) {
    const merged = new Map(specTable.fields.map((f) => [f.name, f]));
    for (const name of waiver.baselineFields) merged.set(String(name).toLowerCase(), { name: String(name).toLowerCase(), cname: "(豁免基线)" });
    return [...merged.values()];
  }
  return specTable.fields;
}

/**
 * B31 主校验：文档表/字段 vs 契约表/字段
 * @param projectRoot 项目根
 * @param contractTables Map<tableName, Set<field>>（由调用方从 docs/contracts 或实体扫描汇聚）
 */
function checkDocContractConsistency(projectRoot, contractTables) {
  const output = [];
  const spec = loadDbSpec(projectRoot);
  if (!spec.ok) {
    for (const e of spec.errors) {
      output.push({ rule: "B31", file: DB_SPEC_DIR, line: 1, col: 1, severity: "warn", message: e.message });
    }
    return { issues: output, specTables: 0, matched: 0, waived: 0, waivers: [] };
  }
  const waivers = loadWaivers(projectRoot);
  const contractNames = new Set([...contractTables.keys()].map((n) => n.toLowerCase()));

  for (const [specName, specTable] of spec.tables) {
    const waiver = waivers.active.get(specName);
    // 解析豁免映射：文档名 → 实现名
    const implName = waiver ? String(waiver.to).toLowerCase() : specName;
    const contractFields = contractTables.get(implName);

    if (!contractFields) {
      if (waiver) {
        output.push({
          rule: "B31", file: specTable.source, line: 1, col: 1, severity: "warn",
          message: `表 ${specTable.name}(${specTable.cname}) 已登记豁免改名 → ${waiver.to}，但契约中仍未找到 ${waiver.to}；豁免登记: ${waiver.approvedBy || "?"} ${waiver.date || ""}`,
        });
      } else {
        output.push({
          rule: "B31", file: specTable.source, line: 1, col: 1, severity: "error",
          message: `文档表 ${specTable.name}(${specTable.cname}) 在契约中不存在：可能被改名或漏实现；改名须经审批登记 ${WAIVERS_FILE}`,
        });
      }
      continue;
    }
    if (implName !== specName) {
      output.push({
        rule: "B31", file: specTable.source, line: 1, col: 1, severity: "warn",
        message: `表 ${specTable.name} → ${waiver.to} 为已审批改名（${waiver.reason || "未填理由"}；${waiver.approvedBy || "?"} ${waiver.date || ""}），保持标识可追溯`,
      });
    }
    const baseline = new Set(effectiveBaseline(specTable, waiver).map((f) => f.name));
    const missing = [...baseline].filter((f) => !contractFields.has(f));
    if (missing.length > 0) {
      output.push({
        rule: "B31", file: specTable.source, line: 1, col: 1, severity: "error",
        message: `表 ${specTable.name}(${specTable.cname}) 文档字段未落实于 ${implName}: ${missing.join(",")}；擅自改名/删减字段被 B31 阻断（豁免须在 ${WAIVERS_FILE} 登记字段基线）`,
      });
    }
  }
  // 契约有、文档无：合法演进的提醒（warn 不阻断）
  for (const name of contractNames) {
    if (!spec.tables.has(name) && ![...waivers.active.values()].some((w) => String(w.to).toLowerCase() === name)) {
      output.push({
        rule: "B31", file: "docs/contracts/db", line: 1, col: 1, severity: "warn",
        message: `表 ${name} 存在于契约但文档未收录：属实现超前；建议回写文档或登记来源`,
      });
    }
  }
  return { issues: output, specTables: spec.tables.size, matched: contractNames.size, waived: waivers.active.size, waivers: waivers.entries };
}

module.exports = {
  DB_SPEC_DIR,
  WAIVERS_FILE,
  loadDbSpec,
  loadWaivers,
  checkDocContractConsistency,
};
