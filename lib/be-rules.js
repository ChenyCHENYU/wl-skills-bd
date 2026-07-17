"use strict";

/**
 * lib/be-rules.js — wl-skills-bd 后端确定性规范检测引擎（正则/行级）
 *
 * 对标 wl-skills-kit/lib/ast-rules.js。Java 后端无需 AST（不像 Vue SFC 复杂），
 * 正则 + 行级扫描即可覆盖 80% 高频违规。规则编号 B1~B8。
 *
 * 设计原则：
 *   - 能被 Maven 插件(Checkstyle/PMD/SpotBugs/ArchUnit)确定的，不写进这里
 *   - 这里只做"插件查不了但 AI 容易犯"的：缺注解、SELECT *、目录文件数等
 *   - 输出结构化 issues，供 CLI validate / MCP / convention-audit-be 消费
 *
 * 规则编号 B1~B8 对应 standards：
 *   B1: Controller 公开方法缺 @PreAuthorize        → error（04/11）
 *   B2: Controller 方法缺 @ApiOperation/@GetMapping..HTTP注解 → warn（04/13）
 *   B3: Mapper XML 出现 SELECT *                   → error（06）
 *   B4: Mapper XML 使用 ${} 拼接（SQL 注入风险）    → error（06/11）
 *   B5: Service 写操作方法缺 @Transactional        → warn（05/10）
 *   B6: 单业务子域目录文件数 > 20                   → warn（02）
 *   B7: SELECT 语句缺 COMPANY_ID 过滤（启发式）     → warn（11）
 *   B8: 抛裸 RuntimeException 而非 ServiceException → warn（08）
 *
 * 导出：
 *   runBeRules(targetDir, { scanRel, stagedFiles }) → { issues, stats }
 *   loadExemptions(targetDir) → { isExempt }
 */

const fs = require("fs");
const path = require("path");

// ─── 工具函数 ───────────────────────────────────────────────────────────

function walk(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "target" || e.name === "node_modules" || e.name === ".git")
      continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, list);
    else list.push(fp);
  }
  return list;
}

function pushIssue(issues, rule, severity, file, line, col, message, standard) {
  issues.push({ rule, severity, file, line, col, message, standard });
}

function countLinesBefore(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

// ─── 豁免（项目可在 .be-rules-ignore 声明豁免某规则/路径）─────────────

function loadExemptions(targetDir) {
  const ignoreFile = path.join(targetDir, ".be-rules-ignore");
  if (!fs.existsSync(ignoreFile)) return { isExempt: () => false };
  const globs = fs
    .readFileSync(ignoreFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return {
    isExempt: (relPath, rule) =>
      globs.some((g) => {
        const [gRule, gPath] = g.split(":");
        const ruleOk = !gRule || gRule === rule;
        const pathOk = !gPath || relPath.includes(gPath);
        return ruleOk && pathOk;
      }),
  };
}

// ─── 各规则实现 ─────────────────────────────────────────────────────────

/** B1/B2: Controller 注解检查（以 @XxxMapping 注解为锚点，更可靠）*/
function checkController(content, relFile, issues) {
  // 粗判是否 Controller 文件
  if (!/class\s+\w*Controller\b/.test(content)) return;
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 找 HTTP 映射注解行：@GetMapping / @PostMapping / @PutMapping / @DeleteMapping / @RequestMapping(带路径)
    const isMapping =
      /@(?:Get|Post|Put|Delete|Patch)Mapping\b/.test(line) ||
      /@RequestMapping\s*\(\s*["']/.test(line);
    if (!isMapping) continue;

    // 注解区：从本注解行往上找，直到遇到方法签名或上一个注解块边界
    // 取本行往上 6 行 + 本行 + 往下 1 行（方法签名）作为窗口
    const start = Math.max(0, i - 6);
    const annotWindow = lines.slice(start, i + 2).join("\n");

    // 定位报告行：方法签名行（@Mapping 下方第一个 public/protected）
    let reportLine = i + 1;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      if (/\b(?:public|protected)\s+/.test(lines[j])) {
        reportLine = j + 1;
        break;
      }
    }

    // B1: 有 HTTP 映射注解的方法必须配 @PreAuthorize
    if (!/@PreAuthorize/.test(annotWindow)) {
      pushIssue(
        issues,
        "B1",
        "error",
        relFile,
        reportLine,
        1,
        "Controller 接口方法缺 @PreAuthorize 权限注解（越权风险）",
        "04/11",
      );
    }
    // B2: 有 HTTP 映射但缺 @ApiOperation（文档）
    if (!/@ApiOperation/.test(annotWindow)) {
      pushIssue(
        issues,
        "B2",
        "warn",
        relFile,
        reportLine,
        1,
        "Controller 接口方法缺 @ApiOperation（Swagger 文档缺失）",
        "04/13",
      );
    }
  }
}

/** B3/B4/B7: Mapper XML 检查 */
function checkMapperXml(content, relFile, issues) {
  // B3: SELECT *
  let m;
  const starRe = /SELECT\s+\*/gi;
  while ((m = starRe.exec(content)) !== null) {
    pushIssue(
      issues,
      "B3",
      "error",
      relFile,
      countLinesBefore(content, m.index),
      m.index,
      "Mapper XML 出现 SELECT *（禁止，显式列名）",
      "06",
    );
  }
  // B4: ${} 拼接（SQL 注入），排除 ${ew.customSqlSegment} 等 MyBatis-Plus 合法用法
  const dollarRe = /\$\{[^}]*\}/g;
  while ((m = dollarRe.exec(content)) !== null) {
    const token = m[0];
    if (/ew\.|page\.|param\.wrapper|tenantLineHandler/.test(token)) continue; // MP 合法
    pushIssue(
      issues,
      "B4",
      "error",
      relFile,
      countLinesBefore(content, m.index),
      m.index,
      `Mapper XML 使用 \${} 拼接（SQL 注入风险）: ${token}`,
      "06/11",
    );
  }
  // B7: SELECT 无 COMPANY_ID（启发式，仅单表无 WHERE 时提示）
  const selectRe = /<select[^>]*>([\s\S]*?)<\/select>/gi;
  while ((m = selectRe.exec(content)) !== null) {
    const body = m[1];
    if (!/COMPANY_ID|companyId/i.test(body) && !/\bJOIN\b/i.test(body)) {
      pushIssue(
        issues,
        "B7",
        "warn",
        relFile,
        countLinesBefore(content, m.index),
        m.index,
        "SELECT 语句可能缺 COMPANY_ID 租户过滤（确认是否需租户隔离）",
        "11",
      );
    }
  }
}

/** B5/B8: Service 检查 */
function checkService(content, relFile, issues) {
  if (!/class\s+\w*(?:ServiceImpl|Service)\b/.test(content)) return;
  const lines = content.split(/\r?\n/);
  let inClass = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/class\s+\w*(?:ServiceImpl|Service)\b/.test(line)) inClass = true;
    if (!inClass) continue;

    // B8: throw new RuntimeException / Exception（应抛 ServiceException）
    const rtMatch = line.match(/throw\s+new\s+(RuntimeException|Exception)\s*\(/);
    if (rtMatch) {
      pushIssue(
        issues,
        "B8",
        "warn",
        relFile,
        i + 1,
        rtMatch.index + 1,
        `应抛 ServiceException 而非 ${rtMatch[1]}（统一异常处理）`,
        "08",
      );
    }

    // B5: 含写动词的方法缺 @Transactional（启发式）
    const writeMethod = line.match(
      /^\s*public\s+\w+\s+(save|insert|add|update|delete|remove|batch\w*)\s*\(/i,
    );
    if (writeMethod) {
      const annotWindow = lines.slice(Math.max(0, i - 4), i).join("\n");
      if (!/@Transactional/.test(annotWindow)) {
        pushIssue(
          issues,
          "B5",
          "warn",
          relFile,
          i + 1,
          writeMethod.index + 1,
          `写操作方法 ${writeMethod[1]}(...) 可能缺 @Transactional`,
          "05/10",
        );
      }
    }
  }
}

/** B6: 单业务子域目录文件数 */
function checkDirDensity(targetDir, issues) {
  const dirs = walk(targetDir).map((fp) => path.dirname(fp));
  const count = {};
  for (const d of dirs) count[d] = (count[d] || 0) + 1;
  for (const [d, n] of Object.entries(count)) {
    if (n > 20) {
      const rel = path.relative(targetDir, d).replace(/\\/g, "/") || ".";
      pushIssue(
        issues,
        "B6",
        n > 30 ? "error" : "warn",
        rel,
        0,
        0,
        `单目录 ${n} 个文件 > 20（${n > 30 ? "必须拆" : "建议拆"}子域）`,
        "02",
      );
    }
  }
}

/** B9/B10/B11: 设计级长度与复杂度（standards/19 兜底） */

// 阈值（与 standards/19 §3 对齐，与 P3C/Checkstyle 一致）
const THRESHOLDS = {
  CLASS_MAX_LINES: 500,    // 类行数红线（含注释空行）
  METHOD_MAX_LINES: 80,    // 方法行数硬上限（P3C/阿里手册标准）
  METHOD_MAX_CYCLO: 10,    // 圈复杂度红线
};

/** B9: 类长度 > 500 行（上帝类检测）*/
function checkClassLength(content, relFile, issues) {
  const lines = content.split(/\r?\n/);
  // 定位顶层类型声明（class/interface/enum/@interface），统计到文件末或下一个顶层类型
  const typeStarts = [];
  lines.forEach((line, i) => {
    // 顶层声明：行首非缩进的 class/interface/enum
    if (/^(public\s+|abstract\s+|final\s+)*\s*(class|interface|enum|@interface)\s+\w+/.test(line)) {
      typeStarts.push(i);
    }
  });
  typeStarts.push(lines.length); // 末尾哨兵
  for (let i = 0; i < typeStarts.length - 1; i++) {
    const start = typeStarts[i];
    const end = typeStarts[i + 1];
    const length = end - start;
    if (length > THRESHOLDS.CLASS_MAX_LINES) {
      const match = lines[start].match(/(class|interface|enum)\s+(\w+)/);
      const typeName = match ? match[2] : "?";
      pushIssue(
        issues,
        "B9",
        "error",
        relFile,
        start + 1,
        1,
        `类 ${typeName} ${length} 行 > ${THRESHOLDS.CLASS_MAX_LINES}（上帝类，按职责拆分。standards/19 §3/§6）`,
        "19",
      );
    }
  }
}

/** B10: 方法长度 > 80 行 */
function checkMethodLength(content, relFile, issues) {
  const lines = content.split(/\r?\n/);
  // 匹配方法签名行（含返回类型的 public/protected/private/default 方法，排除 class/接口声明）
  const methodRe = /^(\s+)(?:public|protected|private)\s+(?:static\s+|final\s+|synchronized\s+|abstract\s+|default\s+)*[\w<>\[\],?\s.]+?\s+(\w+)\s*\([^)]*\)\s*(?:throws[^{]*)?\{?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(methodRe);
    if (!m) continue;
    // 从 { 开始数大括号平衡（或从当前行往下数到匹配的 }）
    const braceStart = lines[i].lastIndexOf("{");
    if (braceStart === -1) {
      // 方法签名跨行或抽象方法，跳过（保守不误报）
      continue;
    }
    let depth = 1;
    let j = i;
    // 当前行 { 后部分
    const afterBrace = lines[i].slice(braceStart + 1);
    depth += (afterBrace.match(/\{/g) || []).length - (afterBrace.match(/\}/g) || []).length;
    while (depth > 0 && j + 1 < lines.length) {
      j++;
      depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    }
    const length = j - i + 1;
    if (length > THRESHOLDS.METHOD_MAX_LINES) {
      pushIssue(
        issues,
        "B10",
        length > 150 ? "error" : "warn",
        relFile,
        i + 1,
        1,
        `方法 ${m[2]}() ${length} 行 > ${THRESHOLDS.METHOD_MAX_LINES}（长方法，提取辅助方法。standards/19 §3）`,
        "19",
      );
    }
    i = j; // 跳过方法体（避免内部 lambda/匿名类误判）
  }
}

/** B11: 圈复杂度（近似，统计 if/for/while/case/&&/||/?/catch 关键词）*/
function checkCyclomaticComplexity(content, relFile, issues) {
  const lines = content.split(/\r?\n/);
  // 按 B10 的方法定位逻辑，对每个方法体计复杂度
  const methodRe = /^(\s+)(?:public|protected|private)\s+(?:static\s+|final\s+|synchronized\s+|abstract\s+|default\s+)*[\w<>\[\],?\s.]+?\s+(\w+)\s*\([^)]*\)\s*(?:throws[^{]*)?\{?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(methodRe);
    if (!m) continue;
    const braceStart = lines[i].lastIndexOf("{");
    if (braceStart === -1) continue;
    let depth = 1;
    let j = i;
    const afterBrace = lines[i].slice(braceStart + 1);
    depth += (afterBrace.match(/\{/g) || []).length - (afterBrace.match(/\}/g) || []).length;
    while (depth > 0 && j + 1 < lines.length) {
      j++;
      depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    }
    const body = lines.slice(i, j + 1).join("\n");
    // 圈复杂度近似：每个决策点 +1（基础 1）
    const decisions =
      (body.match(/\bif\s*\(/g) || []).length +
      (body.match(/\bfor\s*\(/g) || []).length +
      (body.match(/\bwhile\s*\(/g) || []).length +
      (body.match(/\bcase\b/g) || []).length +
      (body.match(/&&/g) || []).length +
      (body.match(/\|\|/g) || []).length +
      (body.match(/\?\s*[^:]+:/g) || []).length +
      (body.match(/\bcatch\s*\(/g) || []).length;
    const complexity = 1 + decisions;
    if (complexity > THRESHOLDS.METHOD_MAX_CYCLO) {
      pushIssue(
        issues,
        "B11",
        complexity > 20 ? "error" : "warn",
        relFile,
        i + 1,
        1,
        `方法 ${m[2]}() 圈复杂度 ${complexity} > ${THRESHOLDS.METHOD_MAX_CYCLO}（拆方法 / 多态替代 switch / 卫语句。standards/19 §3）`,
        "19",
      );
    }
    i = j;
  }
}

// ─── 主入口 ─────────────────────────────────────────────────────────────

function runBeRules(targetDir, options = {}) {
  const { scanRel, stagedFiles } = options;
  const { isExempt } = loadExemptions(targetDir);

  let files;
  if (stagedFiles && stagedFiles.length) {
    files = stagedFiles.map((f) => path.join(targetDir, f));
  } else {
    const root = scanRel ? path.join(targetDir, scanRel) : targetDir;
    files = walk(root);
  }

  const issues = [];

  for (const abs of files) {
    const rel = path.relative(targetDir, abs).replace(/\\/g, "/");
    if (isExempt(rel, "*")) continue;

    let content;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    if (rel.endsWith("Controller.java")) {
      if (!isExempt(rel, "B1") && !isExempt(rel, "B2"))
        checkController(content, rel, issues);
      if (!isExempt(rel, "B9") && !isExempt(rel, "B10") && !isExempt(rel, "B11")) {
        checkClassLength(content, rel, issues);
        checkMethodLength(content, rel, issues);
        checkCyclomaticComplexity(content, rel, issues);
      }
    } else if (rel.endsWith(".xml") && /mapper|mybatis/i.test(rel)) {
      if (!isExempt(rel, "B3") && !isExempt(rel, "B4") && !isExempt(rel, "B7"))
        checkMapperXml(content, rel, issues);
    } else if (rel.endsWith(".java") && /(ServiceImpl|Service)\.java$/.test(rel)) {
      if (!isExempt(rel, "B5") && !isExempt(rel, "B8"))
        checkService(content, rel, issues);
      if (!isExempt(rel, "B9") && !isExempt(rel, "B10") && !isExempt(rel, "B11")) {
        checkClassLength(content, rel, issues);
        checkMethodLength(content, rel, issues);
        checkCyclomaticComplexity(content, rel, issues);
      }
    } else if (rel.endsWith(".java")) {
      // 其他 Java 文件（Entity/DTO/VO/Util 等）也查设计级长度
      if (!isExempt(rel, "B9") && !isExempt(rel, "B10") && !isExempt(rel, "B11")) {
        checkClassLength(content, rel, issues);
        checkMethodLength(content, rel, issues);
        checkCyclomaticComplexity(content, rel, issues);
      }
    }
  }

  // B6 目录密度（全量扫描，不按文件）
  if (!stagedFiles) {
    checkDirDensity(targetDir, issues);
  }

  const stats = {
    error: issues.filter((i) => i.severity === "error").length,
    warn: issues.filter((i) => i.severity === "warn").length,
    total: issues.length,
    byRule: issues.reduce((acc, i) => {
      acc[i.rule] = (acc[i.rule] || 0) + 1;
      return acc;
    }, {}),
  };

  return { issues, stats };
}

module.exports = { runBeRules, loadExemptions };
