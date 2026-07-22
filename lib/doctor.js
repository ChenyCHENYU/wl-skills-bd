"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const installer = require("./installer");
const { STATE_REL } = require("./codegen");
const { listConfigFiles } = require("./config-layering");
const { DEFAULT_GOVERNANCE, validateGovernance } = require("./governance");
const { normalizeEnvironment, PROTECTED_ENVS } = require("./write-guard");

function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return { ok: result.status === 0, output: output.split(/\r?\n/)[0] || (result.error && result.error.message) || "不可用" };
}

function includesAll(file, tokens) {
  if (!fs.existsSync(file)) return false;
  const content = fs.readFileSync(file, "utf8");
  return tokens.every((token) => content.includes(token));
}

function treeContains(root, tokens) {
  if (!fs.existsSync(root)) return false;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        if (["target", ".git", "node_modules"].includes(entry)) continue;
        pending.push(path.join(current, entry));
      }
      continue;
    }
    if (!/\.(java|xml|ya?ml|properties)$/.test(current)) continue;
    const content = fs.readFileSync(current, "utf8");
    if (tokens.some((token) => content.includes(token))) return true;
  }
  return false;
}

function treeContainsAll(root, tokens) {
  return tokens.every((token) => treeContains(root, [token]));
}

function listEntities(srcRoot) {
  const entityRoot = path.join(srcRoot, "main", "java");
  if (!fs.existsSync(entityRoot)) return [];
  const entities = [];
  const stack = [entityRoot];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".java")) {
        const className = entry.name.slice(0, -5);
        try {
          const content = fs.readFileSync(absolute, "utf8");
          if (new RegExp(`class\\s+${className}\\b[\\s\\S]*extends\\s+CoreEntity`).test(content)) {
            entities.push(className);
          }
        } catch { /* ignore */ }
      }
    }
  }
  return entities;
}

function contractCoverage(root) {
  const stateFile = path.join(root, ".wl-skills-bd", ".state", "codegen-manifest.json");
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null;
  const contracts = state && state.contracts ? Object.keys(state.contracts) : [];
  const srcRoot = path.join(root, "src");
  const entities = fs.existsSync(srcRoot) ? listEntities(srcRoot) : [];
  if (entities.length === 0) return { ok: true, detail: "无 CoreEntity 子类（新工程或已迁移）", missing: [] };
  if (contracts.length === 0) {
    return { ok: true, detail: `${entities.length} 个 Entity，无 codegen 契约（手工编码模式）`, missing: entities };
  }
  const contractIds = new Set(contracts);
  const entityToContract = (name) => {
    const lower = name.toLowerCase();
    return contracts.find((id) => {
      const tail = id.split("-").slice(1).join("-");
      return id === lower || tail === lower || lower.endsWith(tail);
    });
  };
  const missing = entities.filter((name) => !entityToContract(name));
  if (missing.length === 0) return { ok: true, detail: `${entities.length} 个 Entity 全部覆盖契约`, missing: [] };
  return { ok: true, detail: `${entities.length} 个 Entity，${missing.length} 个无对应契约（建议补 wl-contract.json）`, missing };
}

function readBootstrapProfile(root) {
  const candidates = [
    path.join(root, "src", "main", "resources", "bootstrap.yml"),
    path.join(root, "src", "main", "resources", "bootstrap.yaml"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, "utf8");
      const m = content.match(/profiles:\s*\n\s*active:\s*(?:\$\{PROFILES_ACTIVE:([^}}]+)\}|(\w+))/);
      if (m) return { file, profile: (m[1] || m[2]).trim() };
    } catch { /* ignore */ }
  }
  return null;
}

function detectDbClusterFromDatasource(root, profile) {
  if (!profile) return null;
  const candidates = [
    path.join(root, "src", "main", "resources", `datasource-${profile}.yml`),
    path.join(root, "src", "main", "resources", `datasource-${profile}.yaml`),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, "utf8");
      if (/-cx[-.]/.test(file) || /url:.*cxdb/i.test(content)) return "cx";
      if (/-non_cx[-.]/.test(file) || /url:.*non_cxdb/i.test(content)) return "non_cx";
      if (/-pt[-.]/.test(file) || /url:.*ptdb/i.test(content)) return "pt";
    } catch { /* ignore */ }
  }
  return null;
}

const VALID_PROFILES = new Set(["dev", "sit", "uat", "pre", "prod"]);

function checkEnvironment(root, add) {
  const bootstrap = readBootstrapProfile(root);
  if (!bootstrap) {
    add("env-bootstrap", false, "缺 bootstrap.yml / profiles.active", "创建 src/main/resources/bootstrap.yml，按 standards/24 §3.1 配置");
    add("env-config", false, "环境配置未识别", "按 standards/24 配置 profile");
    return;
  }
  const profile = bootstrap.profile;
  add("env-bootstrap", true, `bootstrap.yml profile=${profile}`);
  if (!VALID_PROFILES.has(profile)) {
    add("env-config", false, `profile=${profile} 不在白名单 dev/sit/uat/pre/prod`, "修正 spring.profiles.active");
    return;
  }
  const env = normalizeEnvironment(process.env.WL_PROJECT_ENV || profile);
  if (PROTECTED_ENVS.has(env) && process.env.WL_ALLOW_PRODUCTION_WRITES === "true") {
    add("env-config", false, `受保护环境 ${env} 已显式开放工程写入`, "确认这是受控操作，操作完成立即撤销 WL_ALLOW_PRODUCTION_WRITES");
  } else if (PROTECTED_ENVS.has(env)) {
    add("env-config", true, `profile=${profile}（受保护环境工程 apply 已阻断）`);
  } else {
    add("env-config", true, `profile=${profile}`);
  }
  const dbCluster = detectDbClusterFromDatasource(root, profile);
  if (dbCluster) add("env-dbcluster", true, `dbCluster=${dbCluster}（datasource profile 识别）`);
  else add("env-dbcluster", false, "datasource profile 未识别 dbCluster", "datasource dataId 命名加 -cx/-non_cx/-pt 后缀");
}

function readGovernanceRules(root) {
  const file = path.join(root, ".wl-skills-bd", "rules.local.json");
  if (!fs.existsSync(file)) return { exists: false, file };
  try {
    return { exists: true, file, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { exists: true, file, error: error.message };
  }
}

function detectRuntimeSoftDelete(root) {
  let activeValue = null;
  let deletedValue = null;
  const evidence = [];
  for (const file of listConfigFiles(root)) {
    let content;
    try { content = fs.readFileSync(file.abs, "utf8"); } catch { continue; }
    const active = content.match(/(?:logic-not-delete-value|logicNotDeleteValue)\s*[:=]\s*["']?(-?\d+)/i);
    const deleted = content.match(/(?:logic-delete-value|logicDeleteValue)\s*[:=]\s*["']?(-?\d+)/i);
    if (active) {
      activeValue = Number(active[1]);
      evidence.push(file.rel);
    }
    if (deleted) {
      deletedValue = Number(deleted[1]);
      evidence.push(file.rel);
    }
  }
  return { activeValue, deletedValue, evidence: [...new Set(evidence)] };
}

function checkGovernance(root, profile, add) {
  const validation = validateGovernance(profile);
  add(
    "governance-profile",
    validation.ok,
    validation.ok
      ? `软删除 ${validation.governance.softDelete.activeValue}/${validation.governance.softDelete.deletedValue}，审计时间 ${validation.governance.auditTime.mysqlType}`
      : validation.errors.join("；"),
    "修正当前 profile 的 softDelete/auditTime 治理契约",
  );
  if (!validation.ok) return;

  const expected = validation.governance.softDelete;
  const rules = readGovernanceRules(root);
  const usesDefault = expected.activeValue === DEFAULT_GOVERNANCE.softDelete.activeValue
    && expected.deletedValue === DEFAULT_GOVERNANCE.softDelete.deletedValue;
  if (!rules.exists) {
    add(
      "governance-rules",
      usesDefault,
      usesDefault ? "rules.local.json 未覆盖，沿用默认软删除口径" : "profile 已覆盖软删除口径，但缺 rules.local.json",
      "新增 .wl-skills-bd/rules.local.json，并令 softDelete 与 profile 完全一致",
    );
  } else if (rules.error) {
    add("governance-rules", false, `rules.local.json 解析失败：${rules.error}`, "修复 JSON 格式");
  } else {
    const actual = rules.value && rules.value.softDelete;
    const matches = actual && actual.activeValue === expected.activeValue
      && actual.deletedValue === expected.deletedValue;
    add(
      "governance-rules",
      Boolean(matches),
      matches ? "profile 与 rules.local.json 软删除口径一致" : "profile 与 rules.local.json 软删除口径不一致",
      "统一 profile.softDelete 与 rules.local.json.softDelete",
    );
  }

  const runtime = detectRuntimeSoftDelete(root);
  if (runtime.activeValue === null && runtime.deletedValue === null) {
    add(
      "governance-runtime",
      true,
      "本地未发现 MyBatis-Plus 软删除运行值；若由 Nacos 下发，联调前须保留配置证据",
      "在 Nacos/运行时确认 logic-not-delete-value 与 logic-delete-value",
    );
    return;
  }
  const runtimeMatches = runtime.activeValue === expected.activeValue
    && runtime.deletedValue === expected.deletedValue;
  add(
    "governance-runtime",
    runtimeMatches,
    runtimeMatches
      ? `MyBatis-Plus 运行值与 profile 一致（${runtime.evidence.join(", ")}）`
      : `MyBatis-Plus 运行值 ${runtime.activeValue}/${runtime.deletedValue} 与 profile ${expected.activeValue}/${expected.deletedValue} 不一致`,
    "统一 MyBatis-Plus、profile、rules.local.json 三处软删除口径",
  );
}

function runDoctor(projectRootInput) {
  const root = path.resolve(projectRootInput);
  const pom = path.join(root, "pom.xml");
  const checks = [];
  const add = (id, ok, detail, fix) => checks.push({ id, ok, detail, fix });
  const install = installer.check(root);
  add("installation", install.ok, install.ok ? `manifest v${install.version}` : "未安装或文件漂移", "运行 init/update 并处理冲突");
  add("maven-project", fs.existsSync(pom), "pom.xml", "在 Maven 工程根目录执行");
  const configFile = path.join(root, ".wl-skills-bd", "config.json");
  let profile = null;
  if (fs.existsSync(configFile)) {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
      const profileFile = path.join(root, ".wl-skills-bd", "profiles", `${config.defaultProfile}.json`);
      if (fs.existsSync(profileFile)) profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
    } catch {
      profile = null;
    }
  }
  add("profile", Boolean(profile && profile.status === "supported"), profile ? `${profile.id} (${profile.status})` : "profile 缺失或损坏", "运行 update 并选择 supported profile");
  if (profile) checkGovernance(root, profile, add);
  const java = commandVersion("java", ["-version"]);
  const maven = commandVersion("mvn", ["-version"]);
  const javaMatch = java.output.match(/version\s+"(?:1\.)?(\d+)/i) || java.output.match(/(?:openjdk|java)\s+(?:1\.)?(\d+)/i);
  const javaMajor = javaMatch ? Number(javaMatch[1]) : null;
  const requiredJava = profile && Number(profile.java);
  add("java", java.ok && (!requiredJava || javaMajor === requiredJava), java.output, `安装并激活 profile 要求的 Java ${requiredJava || 8}`);
  const wrapper = fs.existsSync(path.join(root, process.platform === "win32" ? "mvnw.cmd" : "mvnw"));
  add("maven", maven.ok || wrapper, maven.ok ? maven.output : (wrapper ? "Maven Wrapper" : maven.output), "安装 Maven 3.6.3+ 或提交 Maven Wrapper");
  add(
    "quality-config",
    [
      ["checkstyle", "checkstyle.xml"],
      ["pmd", "pmd-ruleset.xml"],
      ["spotbugs", "spotbugs-exclude.xml"],
      ["jacoco", "README.md"],
      ["maven-snippets", "quality-profile.xml"],
    ].every((parts) => fs.existsSync(path.join(root, ".github", "java-quality", ...parts))),
    "J1~J5/J8 配置",
    "运行 wl-skills-bd update",
  );
  add(
    "maven-gates",
    includesAll(pom, ["maven-checkstyle-plugin", "maven-pmd-plugin", "spotbugs-maven-plugin", "spotless-maven-plugin", "jacoco-maven-plugin"]),
    "Checkstyle/PMD7/SpotBugs/Spotless/JaCoCo",
    "接入 java-quality/maven-snippets/quality-profile.xml",
  );
  add(
    "archunit",
    fs.existsSync(pom) && includesAll(pom, ["archunit-junit5"]) && treeContains(path.join(root, "src", "test"), ["class LayerRulesTest"]),
    "ArchUnit 依赖与 LayerRulesTest",
    "接入 ArchUnit 并复制、渲染 LayerRulesTest",
  );
  const tenantInterceptor = treeContainsAll(root, ["TenantLineInnerInterceptor", "addInnerInterceptor"]);
  const explicitTenant = treeContainsAll(root, ["AuthUtil.getLoginCompanyId", "COMPANY_ID", "updateAtomic"]);
  add(
    "tenant",
    tenantInterceptor || explicitTenant,
    tenantInterceptor ? "TenantLineInnerInterceptor 已注册" : (explicitTenant ? "显式租户读写 + 原子更新证据" : "缺少可验证的租户读写链"),
    "注册 TenantLineInnerInterceptor，或使用 AuthUtil + Mapper XML COMPANY_ID + updateAtomic 显式模式",
  );
  const optimistic = treeContainsAll(root, ["OptimisticLockerInnerInterceptor", "addInnerInterceptor"])
    || treeContainsAll(root, ["REVISION = REVISION + 1", "expectedRevision", "updateAtomic"]);
  add("optimistic-write", optimistic, optimistic ? "乐观锁拦截器或显式原子版本写已接入" : "未验证乐观锁写链", "注册 OptimisticLockerInnerInterceptor，或使用 REVISION 原子条件更新");
  const blockAttack = treeContainsAll(root, ["BlockAttackInnerInterceptor", "addInnerInterceptor"]);
  add("block-attack", blockAttack, blockAttack ? "BlockAttackInnerInterceptor 已注册" : "未验证 MyBatis-Plus 全表更新/删除拦截器", "在 MybatisPlusInterceptor 中注册 BlockAttackInnerInterceptor，作为 B18 运行时第二道防线");
  const coverage = contractCoverage(root);
  add("contract-coverage", coverage.ok, coverage.detail, "为新增 Entity 补 wl-contract.json 并 codegen apply，避免手工编码漂移");
  checkEnvironment(root, add);
  return { ok: checks.every((item) => item.ok), root, checks };
}

module.exports = {
  checkEnvironment,
  checkGovernance,
  contractCoverage,
  detectDbClusterFromDatasource,
  detectRuntimeSoftDelete,
  listEntities,
  readBootstrapProfile,
  runDoctor,
};
