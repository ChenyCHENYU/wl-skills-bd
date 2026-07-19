"use strict";

const fs = require("fs");
const path = require("path");

const PROTECTED_ENVS = new Set(["pre", "prod", "production"]);
const VALID_ENVS = new Set(["dev", "sit", "uat", "pre", "prod", "production"]);

function normalizeEnvironment(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return VALID_ENVS.has(normalized) ? normalized : null;
}

function detectEnvironment(projectRoot, contract) {
  const contractEnvironment = normalizeEnvironment(contract && contract.environment);
  if (contractEnvironment) return contractEnvironment;
  const explicit = normalizeEnvironment(process.env.WL_PROJECT_ENV);
  if (explicit) return explicit;
  const springProfile = normalizeEnvironment(process.env.SPRING_PROFILES_ACTIVE);
  if (springProfile) return springProfile;
  try {
    const configFile = path.join(projectRoot, ".wl-skills-bd", "config.json");
    if (fs.existsSync(configFile)) {
      const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"));
      const configured = normalizeEnvironment(cfg.environment);
      if (configured) return configured;
    }
  } catch { /* 解析错误由 config doctor 报告；此处继续寻找明确环境信号。 */ }
  try {
    const bootstrapFile = path.join(projectRoot, "src", "main", "resources", "bootstrap.yml");
    if (fs.existsSync(bootstrapFile)) {
      const content = fs.readFileSync(bootstrapFile, "utf8");
      const match = content.match(/profiles:\s*\n\s*active:\s*(?:\$\{PROFILES_ACTIVE:([^}]+)\}|([A-Za-z]+))/);
      const active = normalizeEnvironment(match && (match[1] || match[2]));
      if (active) return active;
    }
  } catch { /* 读取失败交给调用方正常错误链。 */ }
  return null;
}

function isProtectedWriteBlocked(environment, allowProtectedWrites = false) {
  return PROTECTED_ENVS.has(normalizeEnvironment(environment))
    && allowProtectedWrites !== true
    && process.env.WL_ALLOW_PRODUCTION_WRITES !== "true";
}

function guardResult(projectRoot, options = {}, contract) {
  const environment = detectEnvironment(projectRoot, contract);
  if (!isProtectedWriteBlocked(environment, options.allowProductionWrites)) return null;
  return {
    ok: false,
    reason: "production-write-guard",
    environment,
    applied: [],
    hint: "pre/prod/production 环境的工程文件写入默认阻断；复核预览后才能显式授权。",
  };
}

module.exports = {
  PROTECTED_ENVS,
  VALID_ENVS,
  detectEnvironment,
  guardResult,
  isProtectedWriteBlocked,
  normalizeEnvironment,
};
