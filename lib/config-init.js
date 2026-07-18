"use strict";

const fs = require("fs");
const path = require("path");
const { render } = require("./template-engine");
const { resolveWithin } = require("./manifest");

const TEMPLATE_ROOT = path.resolve(__dirname, "..", "files", ".wl-skills-bd", "templates", "config");

function template(name) {
  return fs.readFileSync(path.join(TEMPLATE_ROOT, name), "utf8");
}

function buildInitPlan(root, options = {}) {
  const project = options.project || "wl-app";
  const module = options.module || project.replace(/^wl-/, "").replace(/-/g, "");
  const port = options.port || 9100;
  const datasourceType = options.datasourceType || "mysql";
  const customer = options.customer || "internal";
  const currentProfile = options.profile || "dev";

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

  return {
    ok: true,
    project,
    module,
    port,
    datasourceType,
    customer,
    currentProfile,
    actions,
    summary: { files: actions.length },
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
  const applied = [];
  for (const action of plan.actions) {
    const dest = resolveWithin(options.projectRoot || process.cwd(), action.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (action.action === "append-if-missing") {
      const existing = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : "";
      if (!existing.includes("# wl-skills-bd 配置分层")) {
        fs.appendFileSync(dest, (existing.endsWith("\n") ? "" : "\n") + action.content, "utf8");
        applied.push({ rel: action.rel, result: "appended" });
      } else {
        applied.push({ rel: action.rel, result: "exists" });
      }
    } else {
      if (fs.existsSync(dest) && options.overwrite !== true) {
        applied.push({ rel: action.rel, result: "exists-skipped", hint: "已存在，--overwrite 强制覆盖" });
      } else {
        fs.writeFileSync(dest, action.content, "utf8");
        applied.push({ rel: action.rel, result: "created" });
      }
    }
  }
  return { ok: true, applied, project: plan.project, port: plan.port };
}

module.exports = { applyInitPlan, buildInitPlan, renderEnvExample, renderEnvMatrixSkeleton, renderGitignore };
