"use strict";

const path = require("node:path");

function taskRules(plan) {
  const rules = Array.isArray(plan?.ruleRefs)
    ? plan.ruleRefs.map((rule) => rule.legacyId).filter((id) => /^B[0-9]+$/.test(id))
    : [];
  if (!rules.length) {
    const error = new Error("当前任务没有允许的 B 规则，不能默认扩大为全规则检查");
    error.code = "unresolved-plan";
    throw error;
  }
  return rules;
}

/** CLI syntax and executor range semantics belong to BD, independent of hosts. */
function buildArguments({ executor, parameters, projectRoot, runId, plan }) {
  const target = parameters.targets[0];
  if (executor.id === "validate") {
    // 原 CLI 缺省会扫全规则；结构化入口必须遵守当前任务的规则范围。
    const rules = parameters.rules || taskRules(plan);
    return ["validate", target, "--target", projectRoot, "--run-id", runId, "--json",
      "--rules", rules.join(",")];
  }
  if (executor.id === "review-run") {
    if (path.resolve(projectRoot, target) !== projectRoot) {
      const error = new Error("BD review run 仅支持项目根范围；文件或子目录使用 validate 执行器");
      error.code = "unsupported-executor-range";
      throw error;
    }
    return ["review", "run", "--target", projectRoot, "--run-id", runId, "--json", "--rules", taskRules(plan).join(",")];
  }
  const error = new Error(`BD 未实现执行器：${executor.id}`);
  error.code = "unsupported-executor";
  throw error;
}

function invoke(input) {
  const args = buildArguments(input);
  return require("./executor-process.cjs").invokeCli({
    cli: path.join(__dirname, "../bin/wl-skills-bd.js"),
    args,
    projectRoot: input.projectRoot,
  });
}

module.exports = { buildArguments, invoke };
