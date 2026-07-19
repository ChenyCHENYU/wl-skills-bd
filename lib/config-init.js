"use strict";

const fs = require("fs");
const path = require("path");
const { render } = require("./template-engine");
const { hashJson } = require("./deterministic");
const { hashFile, resolveWithin, writeTextAtomic } = require("./manifest");
const { guardResult } = require("./write-guard");

const TEMPLATE_ROOT = path.resolve(__dirname, "..", "files", ".wl-skills-bd", "templates", "config");

function template(name) {
  return fs.readFileSync(path.join(TEMPLATE_ROOT, name), "utf8");
}

function buildInitPlan(root, options = {}) {
  const projectRoot = path.resolve(root || process.cwd());
  const project = options.project || "wl-app";
  const module = options.module || project.replace(/^wl-/, "").replace(/-/g, "");
  const port = options.port || 9100;
  const datasourceType = options.datasourceType || "mysql";
  const customer = options.customer || "internal";
  const currentProfile = options.profile || "dev";
  const overwrite = options.overwrite === true;

  const actions = [];

  // L1 bootstrap.yml
  actions.push({
    kind: "bootstrap",
    rel: "src/main/resources/bootstrap.yml",
    content: render(template("bootstrap.yml.tmpl"), { project, datasourceType }),
    action: "write",
  });

  // L1 application.yml
  actions.push({
    kind: "application",
    rel: "src/main/resources/application.yml",
    content: render(template("application.yml.tmpl"), { project, port }),
    action: "write",
  });

  // L1 logback-spring.xml
  actions.push({
    kind: "logback",
    rel: "src/main/resources/logback-spring.xml",
    content: template("logback-spring.xml.tmpl"),
    action: "write",
  });

  // L2 .env.example ×5（示例文件，进 git）
  for (const env of ["dev", "sit", "uat", "pre", "prod"]) {
    actions.push({
      kind: "env-example",
      env,
      rel: `.env.${env}.example`,
      content: renderEnvExample({ project, port, datasourceType, env, customer, module }),
      action: "write",
    });
  }

  // L2 env-matrix.yml（骨架）
  actions.push({
    kind: "env-matrix",
    rel: ".wl-skills-bd/env-matrix.yml",
    content: renderEnvMatrixSkeleton({ project, module, port, datasourceType, customer }),
    action: "write",
  });

  // .gitignore 补 .env.*（排除 .example）
  actions.push({
    kind: "gitignore",
    rel: ".gitignore",
    content: renderGitignore(),
    action: "append-if-missing",
  });

  for (const action of actions) {
    const destination = resolveWithin(projectRoot, action.rel);
    action.currentHash = fs.existsSync(destination) ? hashFile(destination) : null;
  }
  const planHash = hashJson({
    project,
    module,
    port,
    datasourceType,
    customer,
    currentProfile,
    overwrite,
    actions: actions.map((action) => ({ rel: action.rel, currentHash: action.currentHash, contentHash: hashJson(action.content) })),
  });
  return {
    ok: true,
    projectRoot,
    project,
    module,
    port,
    datasourceType,
    customer,
    currentProfile,
    overwrite,
    actions,
    summary: { files: actions.length },
    planHash,
  };
}

function renderEnvExample(ctx) {
  const isProd = ctx.env === "prod";
  const lines = [
    `# .env.${ctx.env}.example（L2 环境变量层）— 由 wl-skills-bd config init 生成`,
    `# 复制为 .env.${ctx.env} 并填充实际值；.env.* 不进 git（见 .gitignore）`,
    `# 详见 standards/25 §1.3`,
    "",
    `# ===== Spring Profile =====`,
    `PROFILES_ACTIVE=${ctx.env}`,
    "",
    `# ===== 应用 =====`,
    `APP_NAME=${ctx.project}`,
    `SERVER_PORT=${ctx.port}`,
    "",
    `# ===== Nacos =====`,
    `NACOS_HOST=nacos:8848`,
    `NACOS_USERNAME=nacos`,
    `NACOS_PASSWORD=***CHANGE_ME***`,
    `NACOS_CONFIG_NAMESPACE=${ctx.env}`,
    `NACOS_DISCOVERY_NAMESPACE=${ctx.env}`,
    "",
    `# ===== DataSource =====`,
    `DATASOURCE=${ctx.datasourceType}`,
    `DB_HOST=db-${ctx.env}`,
    `DB_PORT=${ctx.datasourceType === "oracle" ? 1521 : 3306}`,
    `DB_SID=${ctx.datasourceType === "oracle" ? "ORCL" : "hx_ptdb"}`,
    `DB_USERNAME=dbuser`,
    `DB_PASSWORD=***CHANGE_ME***`,
    "",
    `# ===== Redis =====`,
    `REDIS_HOST=redis-${ctx.env}`,
    `REDIS_PORT=6379`,
    `REDIS_PASSWORD=***CHANGE_ME***`,
    "",
    `# ===== OpenAPI（生产关闭）=====`,
  ];
  if (isProd) {
    lines.push("SPRINGDOC_ENABLED=false");
    lines.push("SPRINGDOC_UI_ENABLED=false");
    lines.push("KNIFE4J_PRODUCTION=true");
  } else {
    lines.push("SPRINGDOC_ENABLED=true");
    lines.push("SPRINGDOC_UI_ENABLED=true");
    lines.push("KNIFE4J_PRODUCTION=false");
  }
  lines.push("");
  return lines.join("\n");
}

function renderEnvMatrixSkeleton(ctx) {
  const dbPort = ctx.datasourceType === "oracle" ? "1521" : "3306";
  return [
    "# 环境差异矩阵（单一事实源）— 由 wl-skills-bd config init 生成",
    "# 详见 standards/25 §2",
    "# ⚠️ secrets 只写占位，实际值在 K8s Secret/.env，不进 git",
    "",
    "schemaVersion: 1",
    `project: ${ctx.project}`,
    `module: ${ctx.module}`,
    `current: ${ctx.customer}`,
    "",
    "customers:",
    `  ${ctx.customer}:`,
    "    nacos:",
    '      host: "nacos:8848"',
    '      username: "nacos"',
    "      namespaces:",
    "        dev: dev",
    "        sit: sit",
    "        uat: uat",
    "        pre: pre",
    "        prod: prod",
    "    datasource:",
    "      cluster: pt",
    `      type: ${ctx.datasourceType}`,
    "      dev:",
    '        host: "db-dev"',
    `        port: ${dbPort}`,
    '        sid: "hx_ptdb"',
    '        username: "ptuser"',
    "      prod:",
    '        host: "db-prod"',
    `        port: ${dbPort}`,
    '        sid: "hx_ptdb"',
    '        username: "ptuser"',
    "    redis:",
    "      dev:",
    '        host: "redis-dev"',
    "        port: 6379",
    "      prod:",
    '        host: "redis-prod"',
    "        port: 6379",
    "    k8s:",
    '      registry: "harbor.example.com/hx-digital"',
    '      namespace: "micro-services"',
    `      port: ${ctx.port}`,
    "      replicas:",
    "        dev: 1",
    "        prod: 2",
    "    secrets:",
    '      nacos_password: "K8s Secret: micro-services-secret/password"',
    '      db_password: "K8s Secret: db-secret/password"',
    '      redis_password: "K8s Secret: redis-secret/password"',
    "",
  ].join("\n");
}

function renderGitignore() {
  return [
    "# wl-skills-bd 配置分层（standards/25）",
    ".env",
    ".env.*",
    "!.env.*.example",
    ".env.*.*",
    "!.env.*.example",
    "",
  ].join("\n");
}

function applyInitPlan(plan, options = {}) {
  if (!plan.ok) return { ok: false, applied: [] };
  if (options.confirm !== true && options.dryRun !== true) return { ok: false, reason: "confirm-required", applied: [] };
  if (options.dryRun) return { ok: true, dryRun: true, applied: plan.actions.map((a) => ({ rel: a.rel, action: "preview" })) };
  if (!options.planHash || options.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [] };
  }
  const projectRoot = path.resolve(options.projectRoot || plan.projectRoot || process.cwd());
  const guarded = guardResult(projectRoot, options);
  if (guarded) return guarded;
  const fresh = buildInitPlan(projectRoot, {
    project: plan.project,
    module: plan.module,
    port: plan.port,
    datasourceType: plan.datasourceType,
    customer: plan.customer,
    profile: plan.currentProfile,
    overwrite: plan.overwrite,
  });
  if (fresh.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, applied: [] };
  }
  const applied = [];
  const journal = [];
  try {
    for (const action of fresh.actions) {
      const dest = resolveWithin(projectRoot, action.rel);
      const existed = fs.existsSync(dest);
      const before = existed ? fs.readFileSync(dest) : null;
      if (action.action === "append-if-missing") {
        const existing = before ? before.toString("utf8") : "";
        if (!existing.includes("# wl-skills-bd 配置分层")) {
          journal.push({ dest, existed, before });
          writeTextAtomic(dest, existing + (existing && !existing.endsWith("\n") ? "\n" : "") + action.content);
          applied.push({ rel: action.rel, result: "appended" });
        } else {
          applied.push({ rel: action.rel, result: "exists" });
        }
      } else if (existed && !fresh.overwrite) {
        applied.push({ rel: action.rel, result: "exists-skipped", hint: "已存在，重新 preview 时显式 overwrite 才能覆盖" });
      } else {
        journal.push({ dest, existed, before });
        writeTextAtomic(dest, action.content);
        applied.push({ rel: action.rel, result: existed ? "updated" : "created" });
      }
    }
  } catch (error) {
    try {
      for (const item of journal.reverse()) {
        if (item.existed) writeTextAtomic(item.dest, item.before);
        else if (fs.existsSync(item.dest)) fs.unlinkSync(item.dest);
      }
    } catch (rollbackError) {
      return { ok: false, reason: "write-failed-rollback-failed", message: `${error.message}; rollback: ${rollbackError.message}`, applied: [] };
    }
    return { ok: false, reason: "write-failed-rolled-back", message: error.message, applied: [] };
  }
  return { ok: true, planHash: fresh.planHash, applied, project: fresh.project, port: fresh.port };
}

module.exports = { applyInitPlan, buildInitPlan, renderEnvExample, renderEnvMatrixSkeleton, renderGitignore };
