"use strict";

const path = require("path");
const {
  detectBootstrapLayer, detectEnvMatrix, detectK8sManifests, detectPort,
  extractK8sConfigMapFields, listConfigFiles, scanPlaintextSecrets,
  checkPortRange, parseYamlKeyValue,
} = require("./config-layering");
const { readMatrix, getCustomerConfig } = require("./env-matrix");
const { probeAll } = require("./config-probe");

const VALID_PROFILES = new Set(["dev", "sit", "uat", "pre", "prod", "slt"]);

function runConfigDoctor(root, options = {}) {
  const checks = [];
  const add = (id, ok, detail, fix, severity) => checks.push({ id, ok, detail, fix, severity: severity || (ok ? "info" : "error") });

  // L0 config-skeleton：bootstrap.yml 存在
  const bootstrap = detectBootstrapLayer(root);
  if (!bootstrap) {
    add("config-skeleton", false, "缺 src/main/resources/bootstrap.yml", "运行 wl-skills-bd config init 生成标准骨架", "error");
    add("config-profile", false, "profile 未识别", "创建 bootstrap.yml 后重试", "error");
    add("config-nacos", false, "nacos 配置未识别", "创建 bootstrap.yml 后重试", "error");
  } else {
    add("config-skeleton", true, `bootstrap.yml 存在：${bootstrap.file}`);
    if (bootstrap.profile) {
      add("config-profile", true, `profile=${bootstrap.profile}`);
      if (!VALID_PROFILES.has(bootstrap.profile)) {
        add("config-profile", false, `profile=${bootstrap.profile} 不在白名单 dev/sit/uat/pre/prod`, "修正 spring.profiles.active");
      }
    } else {
      add("config-profile", false, "bootstrap.yml 缺 profiles.active", "补 profiles.active 声明");
    }
    if (bootstrap.nacosAddr && bootstrap.namespace && bootstrap.group) {
      add("config-nacos", true, `nacos: ${bootstrap.nacosAddr} | ns=${bootstrap.namespace} | group=${bootstrap.group} | sharedConfigs=${bootstrap.sharedConfigs ? "有" : "缺"}`);
      if (!bootstrap.sharedConfigs) {
        add("config-nacos", false, "bootstrap.yml 未声明 shared-configs（datasource/redis dataId）", "补 shared-configs 拉取动态配置");
      }
    } else {
      add("config-nacos", false, `nacos 配置不完整：addr=${bootstrap.nacosAddr || "?"} ns=${bootstrap.namespace || "?"} group=${bootstrap.group || "?"}`, "补全 nacos.config 的 server-addr/namespace/group");
    }
  }

  // L0 config-secret：明文密码扫描
  const configFiles = listConfigFiles(root);
  const secretIssues = scanPlaintextSecrets(configFiles);
  if (secretIssues.length === 0) {
    add("config-secret", true, `扫描 ${configFiles.length} 个配置文件，无明文敏感信息`);
  } else {
    const details = secretIssues.slice(0, 5).map((s) => `${s.file}:${s.line} ${s.key}`).join("; ");
    add("config-secret", false, `${secretIssues.length} 处明文敏感信息：${details}${secretIssues.length > 5 ? " ..." : ""}`, "运行 wl-skills-bd config fix 自动改为 ${VAR} 占位符");
  }

  // L1 config-placeholder：敏感字段占位符合规（与 config-secret 互补）
  if (bootstrap) {
    // bootstrap.yml 的 password 默认值检查（如 ${VAR:JinG@ng2025} 是反例）
    const bootstrapContent = readFileSyncSafe(path.join(root, bootstrap.file));
    if (bootstrapContent) {
      const badDefault = bootstrapContent.match(/\$\{[A-Z_]+:[^}]*(JinG|password|secret|2025|admin)[^}]*\}/i);
      if (badDefault) {
        add("config-placeholder", false, `bootstrap.yml 占位符默认值疑似泄露敏感信息：${badDefault[0]}`, "移除默认值或改为 ${VAR} 无默认 / ${VAR:CHANGE_ME}");
      } else {
        add("config-placeholder", true, "占位符默认值合规");
      }
    }
  }

  // L2 env-matrix：矩阵存在 + current 客户有效
  const matrixResult = readMatrix(root);
  if (!matrixResult.ok) {
    if (matrixResult.reason === "not-found") {
      add("env-matrix", false, "缺 .wl-skills-bd/env-matrix.yml", "运行 wl-skills-bd config init 生成环境差异矩阵");
    } else {
      add("env-matrix", false, `env-matrix.yml 解析失败：${matrixResult.reason}`, (matrixResult.errors || []).map((e) => `${e.path}: ${e.message}`).join("; "));
    }
    add("env-completeness", false, "环境变量完整性无法校验（缺矩阵）", "先创建 env-matrix.yml");
    add("env-dbcluster", false, "dbCluster 无法校验（缺矩阵）", "先创建 env-matrix.yml");
    add("env-k8s-manifest", false, "K8s 校验跳过（缺矩阵）", "先创建 env-matrix.yml");
  } else {
    const { matrix } = matrixResult;
    add("env-matrix", true, `env-matrix.yml: current=${matrix.current}, ${Object.keys(matrix.customers).length} 个客户`);
    const cfg = getCustomerConfig(matrix, matrix.current, bootstrap && bootstrap.profile ? bootstrap.profile : "dev");
    if (cfg) {
      const missing = [];
      if (!cfg.nacosHost) missing.push("NACOS_HOST");
      if (!cfg.nacosNamespace) missing.push("NACOS_*_NAMESPACE");
      if (!cfg.dbHost) missing.push(`DB_HOST (${matrix.current}.${bootstrap && bootstrap.profile ? bootstrap.profile : "dev"})`);
      if (missing.length === 0) add("env-completeness", true, `客户 ${matrix.current} 环境变量齐全`);
      else add("env-completeness", false, `缺：${missing.join(", ")}`, `在 env-matrix.yml 的 customers.${matrix.current} 补全对应环境`);

      // L4 db-cluster
      const clusterCheck = ["cx", "non_cx", "pt"].includes(cfg.dbCluster);
      add("env-dbcluster", clusterCheck, `dbCluster=${cfg.dbCluster}（${cfg.datasourceType}）`, clusterCheck ? "" : "dbCluster 只能 cx/non_cx/pt");

      // L5 k8s-manifest
      const manifests = detectK8sManifests(root);
      if (manifests.length === 0) {
        add("env-k8s-manifest", true, "无 K8s 部署清单（本地开发或未部署）");
      } else {
        let k8sOk = true;
        const k8sDetails = [];
        for (const m of manifests) {
          const fields = m.name.includes("ConfigMap") || m.content.includes("kind: ConfigMap") ? extractK8sConfigMapFields(m) : {};
          const profile = fields.PROFILES_ACTIVE;
          const ns = fields.NACOS_CONFIG_NAMESPACE;
          if (profile && !VALID_PROFILES.has(profile)) {
            k8sOk = false;
            k8sDetails.push(`${m.name}: PROFILES_ACTIVE=${profile} 不在白名单`);
          }
          if (ns && cfg.nacosNamespace && ns !== cfg.nacosNamespace) {
            k8sOk = false;
            k8sDetails.push(`${m.name}: NACOS_CONFIG_NAMESPACE=${ns} 与 env-matrix(${cfg.nacosNamespace}) 不一致`);
          }
        }
        add("env-k8s-manifest", k8sOk, `${manifests.length} 个 K8s 清单${k8sDetails.length ? "：" + k8sDetails.join("; ") : " 校验通过"}`, k8sOk ? "" : "同步 K8s ConfigMap 的 PROFILES_ACTIVE/NAMESPACE 与 env-matrix");
      }

      // L6 port-range
      const portInfo = detectPort(root);
      if (!portInfo) {
        add("env-port", true, "端口未识别（无 application.yml/K8s），跳过");
      } else {
        const rangeCheck = checkPortRange(matrix.module, portInfo.port);
        add("env-port", rangeCheck.ok, `${rangeCheck.detail}（${portInfo.file}: ${portInfo.raw}）`, rangeCheck.ok ? "" : `修正 server.port 到 ${matrix.module} 端口范围`);
      }

      // L7 env-consistency：bootstrap profile = env-matrix current env = K8s PROFILES_ACTIVE
      const bootstrapProfile = bootstrap && bootstrap.profile;
      const matrixCurrent = matrix.current;
      const k8sProfile = manifests.length > 0 ? (extractK8sConfigMapFields(manifests.find((m) => m.content.includes("ConfigMap")) || manifests[0]).PROFILES_ACTIVE) : null;
      if (bootstrapProfile && k8sProfile && bootstrapProfile !== k8sProfile) {
        add("env-consistency", false, `profile 不一致：bootstrap=${bootstrapProfile}, K8s=${k8sProfile}`, "三方对齐（bootstrap / env-matrix / K8s）");
      } else {
        add("env-consistency", true, `profile 一致性校验通过（bootstrap=${bootstrapProfile || "?"}, K8s=${k8sProfile || "?"}）`);
      }

      // L8 production-guard
      const env = process.env.WL_PROJECT_ENV || bootstrapProfile;
      if (env === "prod" && process.env.WL_ALLOW_PRODUCTION_WRITES === "true") {
        add("env-production-guard", false, "生产环境已显式授权 WL_ALLOW_PRODUCTION_WRITES=true", "确认受控操作，完成后立即撤销");
      } else if (env === "prod") {
        add("env-production-guard", true, "生产环境（codegen apply 已阻断）");
      } else {
        add("env-production-guard", true, `非生产环境（${env || "unknown"}）`);
      }

      // 可选：连通性探测
      if (options.probe) {
        const probeResult = probeAllSync(cfg, options);
        for (const r of probeResult.results) {
          add(`probe-${r.kind}`, r.ok, `${r.label} ${r.host}:${r.port} ${r.ok ? `可达（${r.latencyMs}ms）` : "不可达：" + (r.reason || r.hint || "")}`, r.ok ? "" : (r.hint || `检查 ${r.host}:${r.port} 网络/服务`), r.ok ? "info" : "error");
        }
      }
    }
  }

  return {
    ok: checks.every((c) => c.ok || c.severity !== "error"),
    root,
    checks,
    summary: {
      total: checks.length,
      ok: checks.filter((c) => c.ok).length,
      error: checks.filter((c) => !c.ok && c.severity === "error").length,
      warn: checks.filter((c) => !c.ok && c.severity === "warn").length,
    },
  };
}

function readFileSyncSafe(file) {
  try { return require("fs").readFileSync(file, "utf8"); } catch { return null; }
}

// 同步包装 probeAll（doctor 是同步接口）
function probeAllSync(cfg, options) {
  // probeAll 是 async，doctor 同步场景用 spawnSync 不现实；这里做同步 TCP 探测的简化版
  const net = require("net");
  const results = [];
  const probes = [];
  if (cfg.dbHost && cfg.dbPort) probes.push({ kind: "db", label: "数据库", host: cfg.dbHost, port: Number(cfg.dbPort) });
  if (cfg.redisHost && cfg.redisPort) probes.push({ kind: "redis", label: "Redis", host: cfg.redisHost, port: Number(cfg.redisPort) });
  if (cfg.nacosHost) {
    const { parseHostPort } = require("./config-probe");
    const parsed = parseHostPort(cfg.nacosHost, 8848);
    probes.push({ kind: "nacos", label: "Nacos", host: parsed.host, port: parsed.port });
  }
  const timeout = options.probeTimeoutMs || 3000;
  for (const p of probes) {
    const result = probeTcpSync(p.host, p.port, timeout);
    results.push({ ...p, ...result });
  }
  return { ok: results.every((r) => r.ok), results };
}

function probeTcpSync(host, port, timeoutMs) {
  // 同步 TCP 探测（阻塞，但 doctor 是 CLI 同步工具，可接受）
  const { spawnSync } = require("child_process");
  // 用 Node child_process 调自己探测（避免引入额外依赖）
  const script = `
    const net = require("net");
    const socket = new net.Socket();
    const start = Date.now();
    socket.setTimeout(${timeoutMs});
    socket.once("connect", () => { process.stdout.write(JSON.stringify({ok:true,latencyMs:Date.now()-start})); socket.destroy(); process.exit(0); });
    socket.once("timeout", () => { process.stdout.write(JSON.stringify({ok:false,reason:"timeout",hint:"TCP 连接 ${host}:${port} 超时（${timeoutMs}ms），检查网络/防火墙/服务是否启动"})); socket.destroy(); process.exit(0); });
    socket.once("error", (err) => {
      const hint = err.code === "ECONNREFUSED" ? "服务 ${host}:${port} 拒绝连接（未启动或端口错误）"
        : err.code === "ENOTFOUND" ? "主机 ${host} 无法解析（DNS 错误）"
        : err.code === "EHOSTUNREACH" ? "主机 ${host} 不可达（网络/VPN/防火墙）"
        : "TCP 连接 ${host}:${port} 失败：" + err.message;
      process.stdout.write(JSON.stringify({ok:false,reason:err.code||"error",error:err.message,hint})); socket.destroy(); process.exit(0);
    });
    socket.connect(${port}, "${host}");
  `;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: timeoutMs + 2000, windowsHide: true });
  try {
    const parsed = JSON.parse((r.stdout || "").trim());
    return { ...parsed, host, port };
  } catch {
    return { ok: false, host, port, reason: "probe-error", error: (r.stderr || r.error || "未知").toString().slice(0, 200), hint: `探测 ${host}:${port} 失败，请手动 telnet 验证` };
  }
}

module.exports = { runConfigDoctor, probeAllSync };
