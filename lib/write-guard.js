"use strict";

const fs = require("fs");
const path = require("path");

const PROTECTED_ENVS = new Set(["pre", "prod", "production"]);
const VALID_ENVS = new Set(["dev", "sit", "uat", "pre", "prod", "production"]);

function environmentTokens(value) {
  if (typeof value !== "string") return [];
  return value.toLowerCase().split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean);
}

function recognizedEnvironments(value) {
  return [...new Set(environmentTokens(value).filter((item) => VALID_ENVS.has(item)))];
}

function normalizeEnvironment(value) {
  const environments = recognizedEnvironments(value);
  return environments.find((item) => PROTECTED_ENVS.has(item)) || environments[0] || null;
}

function detectEnvironmentState(projectRoot, contract) {
  const signals = [];
  const invalidSignals = [];
  const addSignal = (source, value) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    if (/^\$\{[A-Z][A-Z0-9_]*\}$/.test(String(value).trim())) return;
    const environments = recognizedEnvironments(String(value));
    if (environments.length === 0) invalidSignals.push({ source, value: String(value) });
    else signals.push({ source, value: String(value), environments });
  };

  addSignal("contract.environment", contract && contract.environment);
  addSignal("WL_PROJECT_ENV", process.env.WL_PROJECT_ENV);
  addSignal("SPRING_PROFILES_ACTIVE", process.env.SPRING_PROFILES_ACTIVE);

  const configFile = path.join(projectRoot, ".wl-skills-bd", "config.json");
  if (fs.existsSync(configFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"));
      addSignal(".wl-skills-bd/config.json", cfg.environment);
    } catch (error) {
      invalidSignals.push({ source: ".wl-skills-bd/config.json", value: "<invalid-json>", error: error.message });
    }
  }

  const bootstrapFile = path.join(projectRoot, "src", "main", "resources", "bootstrap.yml");
  if (fs.existsSync(bootstrapFile)) {
    try {
      const content = fs.readFileSync(bootstrapFile, "utf8");
      const match = content.match(/profiles:\s*\n\s*active:\s*(?:\$\{PROFILES_ACTIVE:([^}]+)\}|([^\s#]+))/);
      if (match) addSignal("bootstrap.yml", match[1] || match[2]);
    } catch (error) {
      invalidSignals.push({ source: "bootstrap.yml", value: "<unreadable>", error: error.message });
    }
  }

  const environments = [...new Set(signals.flatMap((signal) => signal.environments))];
  const protectedEnvironment = environments.find((item) => PROTECTED_ENVS.has(item)) || null;
  return {
    environment: protectedEnvironment || environments[0] || null,
    environments,
    protectedEnvironment,
    conflict: environments.length > 1,
    invalidSignals,
    signals,
  };
}

function detectEnvironment(projectRoot, contract) {
  return detectEnvironmentState(projectRoot, contract).environment;
}

function isProtectedWriteBlocked(environment, allowProtectedWrites = false) {
  return PROTECTED_ENVS.has(normalizeEnvironment(environment)) && allowProtectedWrites !== true;
}

function guardResult(projectRoot, options = {}, contract) {
  const state = detectEnvironmentState(projectRoot, contract);
  if (state.conflict) {
    return {
      ok: false,
      reason: "environment-conflict",
      environment: state.environment,
      environments: state.environments,
      signals: state.signals,
      applied: [],
      hint: "检测到互相冲突的环境信号；统一 contract、WL_PROJECT_ENV、Spring Profile 与项目配置后再写入。",
    };
  }
  if (state.invalidSignals.length > 0 && !state.environment) {
    return {
      ok: false,
      reason: "environment-undetermined",
      environment: null,
      invalidSignals: state.invalidSignals,
      applied: [],
      hint: "存在环境配置但无法确定 dev/sit/uat/pre/prod；写操作按 fail-closed 阻断。",
    };
  }
  if (!isProtectedWriteBlocked(state.environment, options.allowProductionWrites)) return null;
  return {
    ok: false,
    reason: "production-write-guard",
    environment: state.environment,
    signals: state.signals,
    applied: [],
    hint: "pre/prod/production 工程写入默认阻断；复核同一 planHash 后，仅对本次命令显式授权。",
  };
}

module.exports = {
  PROTECTED_ENVS,
  VALID_ENVS,
  detectEnvironment,
  detectEnvironmentState,
  environmentTokens,
  guardResult,
  isProtectedWriteBlocked,
  normalizeEnvironment,
  recognizedEnvironments,
};
