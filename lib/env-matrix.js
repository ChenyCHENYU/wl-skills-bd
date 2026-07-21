"use strict";

const fs = require("fs");
const path = require("path");
const { render } = require("./template-engine");
const { hashJson, stable } = require("./deterministic");
const { hashBuffer, hashFile, writeJsonAtomic, normalizeRel, resolveWithin, writeTextAtomic } = require("./manifest");
const { parseYamlKeyValue } = require("./config-layering");
const { guardResult } = require("./write-guard");

const MATRIX_REL = ".wl-skills-bd/env-matrix.yml";
const ENVS = ["dev", "sit", "uat", "pre", "prod"];

function readMatrix(root) {
  const candidates = [
    path.join(root, ".wl-skills-bd", "env-matrix.yml"),
    path.join(root, ".wl-skills-bd", "env-matrix.yaml"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    return parseMatrixFile(file, root);
  }
  return { ok: false, reason: "not-found", searched: candidates.map((f) => path.relative(root, f)) };
}

function parseMatrixFile(file, root) {
  const content = fs.readFileSync(file, "utf8");
  const matrix = parseYamlToObject(content);
  if (!matrix) return { ok: false, reason: "parse-error", file };
  const errors = validateMatrix(matrix);
  if (errors.length > 0) return { ok: false, reason: "invalid", errors, file: path.relative(root, file).replace(/\\/g, "/") };
  return { ok: true, matrix, file: path.relative(root, file).replace(/\\/g, "/"), raw: content };
}

// 简易 YAML→Object（不引入外部库，只支持 env-matrix 用到的子集）
function parseYamlToObject(content) {
  try {
    const lines = content.split(/\r?\n/);
    const root = {};
    const stack = [{ indent: -1, obj: root, key: null }];
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      if (!raw.trim() || /^\s*#/.test(raw)) continue;
      const indent = raw.length - raw.replace(/^\s+/, "").length;
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1].obj;
      const trimmed = raw.trim();
      // list item
      if (/^-\s+/.test(trimmed)) {
        continue;
      }
      const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      let value = kv[2].trim();
      if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
      if (value === "" || value === "|" || value === ">") {
        const child = {};
        parent[key] = child;
        stack.push({ indent, obj: child, key });
      } else if (value === "true") parent[key] = true;
      else if (value === "false") parent[key] = false;
      else if (/^-?\d+$/.test(value)) parent[key] = Number(value);
      else parent[key] = value;
    }
    return root;
  } catch {
    return null;
  }
}

function validateMatrix(matrix) {
  const errors = [];
  if (!matrix || typeof matrix !== "object") {
    errors.push({ path: "$", message: "矩阵必须是对象" });
    return errors;
  }
  if (matrix.schemaVersion !== 1) errors.push({ path: "schemaVersion", message: "只支持 schemaVersion=1" });
  if (typeof matrix.project !== "string" || !/^[a-z][a-z0-9-]+$/.test(matrix.project)) {
    errors.push({ path: "project", message: "project 必须是小写 kebab-case" });
  }
  if (typeof matrix.module !== "string" || !/^[a-z][a-zA-Z0-9]*$/.test(matrix.module)) {
    errors.push({ path: "module", message: "module 必须是 camelCase" });
  }
  if (typeof matrix.current !== "string") {
    errors.push({ path: "current", message: "current 必须声明当前客户" });
  }
  if (!matrix.customers || typeof matrix.customers !== "object") {
    errors.push({ path: "customers", message: "customers 必须是对象" });
    return errors;
  }
  const customerKeys = Object.keys(matrix.customers);
  if (customerKeys.length === 0) errors.push({ path: "customers", message: "至少声明一个客户" });
  if (matrix.current && !customerKeys.includes(matrix.current)) {
    errors.push({ path: "current", message: `current=${matrix.current} 不在 customers 键中 (${customerKeys.join("/")})` });
  }
  for (const [name, cust] of Object.entries(matrix.customers)) {
    const prefix = `customers.${name}`;
    if (!cust || typeof cust !== "object") { errors.push({ path: prefix, message: "必须是对象" }); continue; }
    if (!cust.nacos || !cust.nacos.host) errors.push({ path: `${prefix}.nacos.host`, message: "nacos.host 必填" });
    if (cust.nacos && cust.nacos.namespaces) {
      // namespaces 可能是 inline 对象字符串（简易解析器限制），尝试解析
      const ns = typeof cust.nacos.namespaces === "string" ? parseInlineObject(cust.nacos.namespaces) : cust.nacos.namespaces;
      if (ns && typeof ns === "object") {
        for (const env of ENVS) {
          if (!ns[env]) errors.push({ path: `${prefix}.nacos.namespaces.${env}`, message: `缺 ${env} namespace` });
        }
      } else {
        errors.push({ path: `${prefix}.nacos.namespaces`, message: "nacos.namespaces 必须含 dev/sit/uat/pre/prod" });
      }
    } else if (cust.nacos) {
      errors.push({ path: `${prefix}.nacos.namespaces`, message: "nacos.namespaces 必须含 dev/sit/uat/pre/prod" });
    }
    if (!cust.datasource) errors.push({ path: `${prefix}.datasource`, message: "datasource 必填" });
    else {
      if (!["cx", "non_cx", "pt"].includes(cust.datasource.cluster)) errors.push({ path: `${prefix}.datasource.cluster`, message: "cluster 只能 cx/non_cx/pt" });
      if (!["oracle", "mysql"].includes(cust.datasource.type)) errors.push({ path: `${prefix}.datasource.type`, message: "type 只能 oracle/mysql" });
    }
    if (!cust.k8s) errors.push({ path: `${prefix}.k8s`, message: "k8s 必填" });
    else {
      if (!cust.k8s.registry) errors.push({ path: `${prefix}.k8s.registry`, message: "k8s.registry 必填" });
      if (!cust.k8s.namespace) errors.push({ path: `${prefix}.k8s.namespace`, message: "k8s.namespace 必填" });
      if (!Number.isInteger(cust.k8s.port)) errors.push({ path: `${prefix}.k8s.port`, message: "k8s.port 必须是整数" });
    }
    if (cust.secrets && typeof cust.secrets === "object") {
      for (const [k, v] of Object.entries(cust.secrets)) {
        if (typeof v === "string" && v.length > 0 && !/K8s Secret|CHANGE_ME|\$\{|<.+>|env/i.test(v) && !/^\*+$/.test(v)) {
          errors.push({ path: `${prefix}.secrets.${k}`, message: `疑似明文敏感值（应为占位如 "K8s Secret: xxx/key"）` });
        }
      }
    }
  }
  return errors;
}

function parseInlineObject(str) {
  // 解析 YAML inline 对象：{ dev: dev, sit: sit, uat: uat, pre: pre, prod: prod }
  if (typeof str !== "string") return null;
  const m = str.match(/^\{(.+)\}$/);
  if (!m) return null;
  const result = {};
  for (const pair of m[1].split(",")) {
    const kv = pair.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*([^,}]+?)\s*$/);
    if (kv) {
      let v = kv[2].trim();
      if (/^["'].*["']$/.test(v)) v = v.slice(1, -1);
      result[kv[1]] = v;
    }
  }
  return result;
}

function getCustomerConfig(matrix, customerName, env) {
  const cust = matrix.customers[customerName];
  if (!cust) return null;
  const nsRaw = cust.nacos && cust.nacos.namespaces;
  const ns = typeof nsRaw === "string" ? parseInlineObject(nsRaw) : nsRaw;
  const nsValue = ns && ns[env];
  const db = cust.datasource && (typeof cust.datasource[env] === "string" ? parseInlineObject(cust.datasource[env]) : cust.datasource[env]) || {};
  const redisRaw = cust.redis && (typeof cust.redis[env] === "string" ? parseInlineObject(cust.redis[env]) : cust.redis[env]);
  const redis = redisRaw || {};
  return {
    customer: customerName,
    env,
    project: matrix.project,
    module: matrix.module,
    port: cust.k8s.port,
    nacosHost: cust.nacos.host,
    nacosUsername: cust.nacos.username || "nacos",
    nacosNamespace: nsValue,
    datasourceType: cust.datasource.type,
    dbCluster: cust.datasource.cluster,
    dbHost: db.host || "",
    dbPort: db.port || "",
    dbSid: db.sid || "",
    dbUsername: db.username || "",
    redisHost: redis.host || "",
    redisPort: redis.port || 6379,
    redisDatabase: redis.database || 0,
    k8sNamespace: cust.k8s.namespace,
    k8sRegistry: cust.k8s.registry,
    k8sReplicas: (cust.k8s.replicas && (typeof cust.k8s.replicas === "string" ? parseInlineObject(cust.k8s.replicas) : cust.k8s.replicas)) || {},
  };
}

function computeMigrationDiff(matrix, fromCustomer, toCustomer) {
  const from = matrix.customers[fromCustomer];
  const to = matrix.customers[toCustomer];
  if (!from) throw new Error(`客户 ${fromCustomer} 不存在`);
  if (!to) throw new Error(`客户 ${toCustomer} 不存在`);
  const diffs = [];
  for (const env of ENVS) {
    const fromCfg = getCustomerConfig(matrix, fromCustomer, env);
    const toCfg = getCustomerConfig(matrix, toCustomer, env);
    const fields = ["nacosHost", "nacosNamespace", "datasourceType", "dbCluster", "dbHost", "dbPort", "dbSid", "dbUsername", "redisHost", "redisPort", "k8sNamespace", "k8sRegistry"];
    for (const f of fields) {
      if (fromCfg[f] !== toCfg[f]) {
        diffs.push({ env, field: f, from: fromCfg[f], to: toCfg[f] });
      }
    }
  }
  return diffs;
}

function renderEnvFile(cfg) {
  const isProd = cfg.env === "prod";
  const context = {
    ...cfg,
    isProd,
  };
  return context;
}

function renderMigrationReport(matrix, fromCustomer, toCustomer, diffs) {
  const lines = [
    `# 配置迁移报告：${fromCustomer} → ${toCustomer}`,
    "",
    `> 由 wl-skills-bd config migrate 生成。L1 代码零改动（全是占位符），仅生成 L2 配置。`,
    `> 项目：${matrix.project} | 模块：${matrix.module}`,
    "",
    "## 差异汇总",
    "",
    `| 环境变量 | ${fromCustomer} | ${toCustomer} |`,
    "|---|---|---|",
  ];
  for (const env of ENVS) {
    const envDiffs = diffs.filter((d) => d.env === env);
    if (envDiffs.length === 0) {
      lines.push(`| ${env} （无差异）| | |`);
    } else {
      for (const d of envDiffs) {
        lines.push(`| ${env}.${d.field} | ${d.from || "-"} | ${d.to || "-"} |`);
      }
    }
  }
  lines.push("");
  lines.push("## 生成产物");
  lines.push("");
  lines.push("- `.env.{customer}.{env}` ×5（部署侧环境变量，不进 git）");
  lines.push("- `deploy/{customer}/k8s-configmap-{env}.yaml` ×5");
  lines.push("- `deploy/{customer}/k8s-secret-{env}.yaml.example` ×5（占位，人工填充）");
  lines.push("- `deploy/{customer}/k8s-deployment-{env}.yaml` ×5");
  lines.push("");
  lines.push("## 部署步骤");
  lines.push("");
  lines.push(`1. 填充 .env.${toCustomer}.{env} 的实际密码（从 K8s Secret 获取）`);
  lines.push("2. 运行 `wl-skills-bd config doctor --probe` 验证连通性");
  lines.push(`3. 更新 Nacos ${toCustomer} namespace 的配置（datasource/redis/mq dataId）`);
  lines.push("4. 部署 K8s ConfigMap + Secret + Deployment");
  lines.push("5. 验证应用启动 + 健康检查");
  lines.push("");
  return lines.join("\n");
}

function buildMigrationPlan(root, options = {}) {
  const projectRoot = path.resolve(root);
  const matrixResult = readMatrix(root);
  if (!matrixResult.ok) {
    return { ok: false, reason: matrixResult.reason, errors: matrixResult.errors || [], searched: matrixResult.searched };
  }
  const { matrix } = matrixResult;
  const toCustomer = options.to;
  if (!toCustomer) return { ok: false, reason: "missing-to" };
  if (!matrix.customers[toCustomer]) return { ok: false, reason: "customer-not-found", customer: toCustomer };
  const fromCustomer = options.from || matrix.current;
  if (!matrix.customers[fromCustomer]) return { ok: false, reason: "from-not-found", customer: fromCustomer };

  const diffs = computeMigrationDiff(matrix, fromCustomer, toCustomer);
  const actions = [];
  for (const env of ENVS) {
    const cfg = getCustomerConfig(matrix, toCustomer, env);
    actions.push({
      kind: "env",
      env,
      rel: `.env.${toCustomer}.${env}`,
      content: renderEnvTemplate(cfg),
      action: "write",
    });
    actions.push({
      kind: "k8s-configmap",
      env,
      rel: `deploy/${toCustomer}/k8s-configmap-${env}.yaml`,
      content: renderK8sConfigmapTemplate(cfg),
      action: "write",
    });
    actions.push({
      kind: "k8s-secret",
      env,
      rel: `deploy/${toCustomer}/k8s-secret-${env}.yaml.example`,
      content: renderK8sSecretTemplate(cfg),
      action: "write",
    });
    actions.push({
      kind: "k8s-deployment",
      env,
      rel: `deploy/${toCustomer}/k8s-deployment-${env}.yaml`,
      content: renderK8sDeploymentTemplate(cfg),
      action: "write",
    });
  }
  actions.push({
    kind: "report",
    rel: `docs/config-migration-${fromCustomer}-to-${toCustomer}.md`,
    content: renderMigrationReport(matrix, fromCustomer, toCustomer, diffs),
    action: "write",
  });
  actions.push({
    kind: "matrix-update",
    rel: matrixResult.file,
    content: updateMatrixCurrent(matrixResult.raw, toCustomer),
    action: "update-current",
    from: fromCustomer,
    to: toCustomer,
  });

  for (const action of actions) {
    const destination = resolveWithin(projectRoot, action.rel);
    action.currentHash = fs.existsSync(destination) ? hashFile(destination) : null;
    action.contentHash = hashJson(action.content);
  }

  const planHash = hashJson({
    from: fromCustomer,
    to: toCustomer,
    diffs,
    actions: actions.map((action) => ({ rel: action.rel, currentHash: action.currentHash, contentHash: action.contentHash })),
    matrixHash: hashJson(matrix),
  });

  return {
    ok: true,
    projectRoot,
    from: fromCustomer,
    to: toCustomer,
    diffs,
    actions,
    planHash,
    matrixFile: matrixResult.file,
  };
}

function renderEnvTemplate(cfg) {
  const isProd = cfg.env === "prod";
  const lines = [
    `# .env.${cfg.customer}.${cfg.env}（L2 环境变量层）— 由 wl-skills-bd config migrate 生成`,
    `# 客户：${cfg.customer} | 环境：${cfg.env}`,
    `# ⚠️ 实际密码从 K8s Secret 获取，本文件不进 git`,
    "",
    `PROFILES_ACTIVE=${cfg.env}`,
    `APP_NAME=${cfg.project}`,
    `SERVER_PORT=${cfg.port}`,
    `NACOS_HOST=${cfg.nacosHost}`,
    `NACOS_USERNAME=${cfg.nacosUsername}`,
    `NACOS_PASSWORD=***CHANGE_ME***`,
    `NACOS_CONFIG_NAMESPACE=${cfg.nacosNamespace}`,
    `NACOS_DISCOVERY_NAMESPACE=${cfg.nacosNamespace}`,
    `DATASOURCE=${cfg.datasourceType}`,
    `DB_HOST=${cfg.dbHost}`,
    `DB_PORT=${cfg.dbPort}`,
    `DB_SID=${cfg.dbSid}`,
    `DB_USERNAME=${cfg.dbUsername}`,
    `DB_PASSWORD=***CHANGE_ME***`,
    `REDIS_HOST=${cfg.redisHost}`,
    `REDIS_PORT=${cfg.redisPort}`,
    `REDIS_PASSWORD=***CHANGE_ME***`,
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

function renderK8sConfigmapTemplate(cfg) {
  return [
    `# K8s ConfigMap（L2 部署侧）— 客户：${cfg.customer} | 环境：${cfg.env}`,
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    `  name: ${cfg.project}-cm`,
    `  namespace: ${cfg.k8sNamespace}`,
    "  labels:",
    `    app: ${cfg.project}`,
    `    customer: ${cfg.customer}`,
    `    env: ${cfg.env}`,
    "data:",
    `  APP_NAME: "${cfg.project}"`,
    `  SERVER_PORT: "${cfg.port}"`,
    `  PROFILES_ACTIVE: "${cfg.env}"`,
    `  NACOS_HOST: "${cfg.nacosHost}"`,
    `  NACOS_USERNAME: "${cfg.nacosUsername}"`,
    `  NACOS_CONFIG_NAMESPACE: "${cfg.nacosNamespace}"`,
    `  NACOS_DISCOVERY_NAMESPACE: "${cfg.nacosNamespace}"`,
    `  DATASOURCE: "${cfg.datasourceType}"`,
    `  DB_HOST: "${cfg.dbHost}"`,
    `  DB_PORT: "${cfg.dbPort}"`,
    `  DB_SID: "${cfg.dbSid}"`,
    `  DB_USERNAME: "${cfg.dbUsername}"`,
    `  REDIS_HOST: "${cfg.redisHost}"`,
    `  REDIS_PORT: "${cfg.redisPort}"`,
    `  MANAGEMENT_ENDPOINT_HEALTH_PROBES_ENABLED: "true"`,
    `  SERVER_SHUTDOWN: "graceful"`,
    `  SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE: "45s"`,
    "",
  ].join("\n");
}

function renderK8sSecretTemplate(cfg) {
  return [
    `# K8s Secret 模板 — 客户：${cfg.customer} | 环境：${cfg.env}`,
    "# ⚠️ .example 文件，实际值人工填充，绝不进 git",
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    `  name: ${cfg.project}-secret`,
    `  namespace: ${cfg.k8sNamespace}`,
    "type: Opaque",
    "stringData:",
    `  NACOS_PASSWORD: "***CHANGE_ME***"`,
    `  DB_PASSWORD: "***CHANGE_ME***"`,
    `  REDIS_PASSWORD: "***CHANGE_ME***"`,
    "",
  ].join("\n");
}

function renderK8sDeploymentTemplate(cfg) {
  const isProd = cfg.env === "prod";
  const replicas = (cfg.k8sReplicas && (cfg.k8sReplicas[cfg.env] || cfg.k8sReplicas.prod)) || (isProd ? 2 : 1);
  const maxReplicas = Math.max(4, Number(replicas) * 2);
  return [
    `# K8s Deployment — 客户：${cfg.customer} | 环境：${cfg.env}`,
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    `  name: ${cfg.project}`,
    `  namespace: ${cfg.k8sNamespace}`,
    "spec:",
    `  replicas: ${replicas}`,
    `  strategy:`,
    `    type: ${isProd ? "RollingUpdate" : "Recreate"}`,
    ...(isProd ? ["    rollingUpdate:", "      maxSurge: 1", "      maxUnavailable: 0"] : []),
    "  selector:",
    "    matchLabels:",
    `      app: ${cfg.project}`,
    "  template:",
    "    metadata:",
    "      labels:",
    `        app: ${cfg.project}`,
    `        customer: ${cfg.customer}`,
    `        env: ${cfg.env}`,
    "    spec:",
    "      automountServiceAccountToken: false",
    "      terminationGracePeriodSeconds: 60",
    "      securityContext:",
    "        seccompProfile:",
    "          type: RuntimeDefault",
    ...(isProd ? [
      "      topologySpreadConstraints:",
      "        - maxSkew: 1",
      "          topologyKey: kubernetes.io/hostname",
      "          whenUnsatisfiable: ScheduleAnyway",
      "          labelSelector:",
      "            matchLabels:",
      `              app: ${cfg.project}`,
    ] : []),
    "      restartPolicy: Always",
    "      volumes:",
    "        - name: tmp",
    "          emptyDir: {}",
    "      containers:",
    `        - name: ${cfg.project}`,
    `          image: "${cfg.k8sRegistry}/${cfg.project}:\${IMAGE_TAG}"`,
    "          imagePullPolicy: IfNotPresent",
    "          securityContext:",
    "            allowPrivilegeEscalation: false",
    "            readOnlyRootFilesystem: true",
    "            runAsNonRoot: true",
    "            capabilities:",
    "              drop:",
    "                - ALL",
    "          volumeMounts:",
    "            - name: tmp",
    "              mountPath: /tmp",
    "          ports:",
    "            - name: http",
    `              containerPort: ${cfg.port}`,
    "          resources:",
    "            limits:",
    `              cpu: "${isProd ? "4" : "1"}"`,
    `              memory: "${isProd ? "4Gi" : "2Gi"}"`,
    "            requests:",
    `              cpu: "500m"`,
    `              memory: "1Gi"`,
    "          readinessProbe:",
    "            httpGet:",
    "              port: http",
    "              path: /actuator/health/readiness",
    "            periodSeconds: 10",
    "            timeoutSeconds: 3",
    "            failureThreshold: 3",
    "          livenessProbe:",
    "            httpGet:",
    "              port: http",
    "              path: /actuator/health/liveness",
    "            periodSeconds: 10",
    "            timeoutSeconds: 3",
    "            failureThreshold: 3",
    "          startupProbe:",
    "            httpGet:",
    "              port: http",
    "              path: /actuator/health/liveness",
    "            periodSeconds: 10",
    "            timeoutSeconds: 3",
    "            failureThreshold: 30",
    "          envFrom:",
    "            - configMapRef:",
    `                name: ${cfg.project}-cm`,
    "            - secretRef:",
    `                name: ${cfg.project}-secret`,
    "---",
    "apiVersion: v1",
    "kind: Service",
    "metadata:",
    `  name: ${cfg.project}`,
    `  namespace: ${cfg.k8sNamespace}`,
    "spec:",
    "  selector:",
    `    app: ${cfg.project}`,
    "  ports:",
    `    - port: ${cfg.port}`,
    `      targetPort: ${cfg.port}`,
    ...(isProd ? [
      "---",
      "apiVersion: policy/v1",
      "kind: PodDisruptionBudget",
      "metadata:",
      `  name: ${cfg.project}`,
      `  namespace: ${cfg.k8sNamespace}`,
      "spec:",
      "  minAvailable: 1",
      "  selector:",
      "    matchLabels:",
      `      app: ${cfg.project}`,
      "---",
      "apiVersion: autoscaling/v2",
      "kind: HorizontalPodAutoscaler",
      "metadata:",
      `  name: ${cfg.project}`,
      `  namespace: ${cfg.k8sNamespace}`,
      "spec:",
      `  minReplicas: ${replicas}`,
      `  maxReplicas: ${maxReplicas}`,
      "  scaleTargetRef:",
      "    apiVersion: apps/v1",
      "    kind: Deployment",
      `    name: ${cfg.project}`,
      "  metrics:",
      "    - type: Resource",
      "      resource:",
      "        name: cpu",
      "        target:",
      "          type: Utilization",
      "          averageUtilization: 70",
      "  behavior:",
      "    scaleDown:",
      "      stabilizationWindowSeconds: 300",
    ] : []),
    "",
  ].join("\n");
}

function updateMatrixCurrent(rawContent, newCurrent) {
  // 替换 current: xxx 行
  return rawContent.replace(/^(\s*current\s*:\s*)([^\n#]+)/m, `$1${newCurrent}`);
}

function applyMigrationPlan(plan, options = {}) {
  if (!plan.ok) return { ok: false, reason: plan.reason, applied: [] };
  if (options.confirm !== true) return { ok: false, reason: "confirm-required", applied: [] };
  if (!options.planHash || options.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [] };
  }
  const projectRoot = path.resolve(options.projectRoot || plan.projectRoot || process.cwd());
  const guarded = guardResult(projectRoot, options);
  if (guarded) return guarded;
  const fresh = buildMigrationPlan(projectRoot, { to: plan.to, from: plan.from });
  if (!fresh.ok || fresh.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, applied: [] };
  }
  const applied = [];
  const journal = [];
  const backupId = `${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${fresh.planHash.slice(0, 12)}`;
  try {
    for (const action of fresh.actions) {
      const dest = resolveWithin(projectRoot, action.rel);
      const existed = fs.existsSync(dest);
      const before = existed ? fs.readFileSync(dest) : null;
      journal.push({ dest, existed, before });
      if (existed) {
        const backup = resolveWithin(projectRoot, `.wl-skills-bd/.state/config-migration-backups/${backupId}/${action.rel}`);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, before);
      }
      writeTextAtomic(dest, action.content);
      applied.push({ rel: action.rel, result: action.action });
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
  return { ok: true, planHash: fresh.planHash, backupId, from: fresh.from, to: fresh.to, applied };
}

function publicMigrationPlan(plan) {
  if (!plan.ok) return plan;
  return {
    ok: true,
    from: plan.from,
    to: plan.to,
    diffs: plan.diffs,
    actionCount: plan.actions.length,
    actions: plan.actions.map((a) => ({ kind: a.kind, env: a.env, rel: a.rel, action: a.action })),
    planHash: plan.planHash,
    matrixFile: plan.matrixFile,
  };
}

module.exports = {
  ENVS,
  MATRIX_REL,
  applyMigrationPlan,
  buildMigrationPlan,
  computeMigrationDiff,
  getCustomerConfig,
  parseYamlToObject,
  publicMigrationPlan,
  readMatrix,
  renderEnvTemplate,
  renderK8sConfigmapTemplate,
  renderK8sDeploymentTemplate,
  renderK8sSecretTemplate,
  renderMigrationReport,
  updateMatrixCurrent,
  validateMatrix,
};
