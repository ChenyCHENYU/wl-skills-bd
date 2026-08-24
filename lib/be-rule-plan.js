"use strict";

/**
 * B 规则执行计划。
 *
 * 规则选择必须发生在扫描和检查之前，不能先跑完整扫描再过滤结果。这里集中
 * 声明每条规则需要的文件类型与执行组，供 be-rules 构建最小 ScanContext。
 */

const catalog = require("../files/.wl-skills-bd/rules/catalog.json");

const RULE_IDS = Object.freeze(
  catalog.rules
    .filter((rule) => /^B\d+$/.test(rule.id))
    .map((rule) => rule.id)
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1))),
);

const GROUPS = Object.freeze({
  controller: { rules: ["B1", "B2"], read: [".java"] },
  mapperSql: { rules: ["B3", "B4", "B7"], read: [".xml"] },
  service: { rules: ["B5", "B8"], read: [".java"] },
  directoryDensity: { rules: ["B6"], discover: [".java"] },
  javaTenant: { rules: ["B7"], read: [".java"] },
  design: { rules: ["B9", "B10", "B11"], read: [".java"] },
  javadoc: { rules: ["B12"], read: [".java"] },
  redisTtl: { rules: ["B13"], read: [".java"] },
  redisLock: { rules: ["B14"], read: [".java"] },
  redisDangerous: { rules: ["B15"], read: [".java"] },
  redisSerializer: { rules: ["B16"], read: [".java"] },
  physicalDelete: { rules: ["B17"], read: [".java", ".xml"] },
  writeSafety: { rules: ["B18"], read: [".java", ".xml"] },
  batchSize: { rules: ["B19"], read: [".java"] },
  transactionBoundary: { rules: ["B20"], read: [".java"] },
  httpTimeout: { rules: ["B21"], read: [".java"] },
  openApi: { rules: ["B22"], read: [".java"] },
  serviceDependencies: { rules: ["B23"], read: [".java"] },
  methodSecurity: { rules: ["B24"], read: [".java"] },
  sensitiveLog: { rules: ["B25"], read: [".java"] },
  mapperDiscovery: { rules: ["B26"], read: [".java", ".xml", ".yml", ".yaml", ".properties"] },
  managedDependencies: { rules: ["B27"], read: [".xml"] },
  extensionBeans: { rules: ["B28"], read: [".java", ".xml"] },
  pagination: { rules: ["B29"], read: [".java"] },
  endpoints: { rules: ["B30"], read: [".java"] },
  databaseSource: { rules: ["B31"] },
});

function skippedReasons(options = {}) {
  const reasons = new Map();
  if (options.quick) {
    for (const rule of ["B9", "B10", "B11", "B12"]) {
      reasons.set(rule, "quick 模式跳过设计级检查");
    }
  }
  if (options.staged) {
    for (const [rule, reason] of [
      ["B6", "staged 模式不计算全目录密度"],
      ["B24", "staged 模式无法证明全项目方法安全启用"],
      ["B26", "staged 模式不做跨文件 Mapper/资源发现"],
      ["B27", "staged 模式不做完整父 BOM 依赖对账"],
      ["B28", "staged 模式不做全项目扩展点 Bean 唯一性对账"],
      ["B29", "staged 模式只覆盖变更文件，分页 Profile 结果不完整"],
      ["B30", "staged 模式无法证明全项目路由唯一"],
      ["B31", "staged 模式不读取全量契约/文档事实源"],
    ]) reasons.set(rule, reason);
  }
  return reasons;
}

function createRuleExecutionPlan(options = {}) {
  const requested = Array.isArray(options.rules) && options.rules.length > 0
    ? [...new Set(options.rules)]
    : [...RULE_IDS];
  const known = requested.filter((rule) => RULE_IDS.includes(rule));
  const unknownRules = requested.filter((rule) => !RULE_IDS.includes(rule));
  const reasons = skippedReasons({ quick: options.quick === true, staged: options.staged === true });
  const skippedRules = known
    .filter((rule) => reasons.has(rule))
    .map((rule) => ({ rule, reason: reasons.get(rule) }));
  const evaluatedRules = known.filter((rule) => !reasons.has(rule));
  const enabled = new Set(evaluatedRules);
  const groups = Object.entries(GROUPS)
    .filter(([, group]) => group.rules.some((rule) => enabled.has(rule)))
    .map(([id]) => id);
  const discoverExtensions = new Set();
  const readExtensions = new Set();
  for (const id of groups) {
    for (const extension of GROUPS[id].discover || []) discoverExtensions.add(extension);
    for (const extension of GROUPS[id].read || []) {
      discoverExtensions.add(extension);
      readExtensions.add(extension);
    }
  }
  return {
    requestedRules: requested,
    evaluatedRules,
    skippedRules,
    unknownRules,
    groups,
    discoverExtensions,
    readExtensions,
    enabled: (rule) => enabled.has(rule),
    groupEnabled: (group) => groups.includes(group),
    coverage: {
      status: skippedRules.length > 0 ? "partial" : "complete",
      mode: options.staged ? "staged" : options.quick ? "quick" : "full",
      evaluatedRules,
      skippedRules,
    },
  };
}

module.exports = { GROUPS, RULE_IDS, createRuleExecutionPlan };
