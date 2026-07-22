"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const configLayering = require("../lib/config-layering");
const envMatrix = require("../lib/env-matrix");
const configInit = require("../lib/config-init");
const configFix = require("../lib/config-fix");
const { runConfigDoctor } = require("../lib/config-doctor");
const { readBootstrapProfile } = require("../lib/doctor");
const troubleshoot = require("../lib/troubleshoot");

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-cfg-"));
  try { fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// ─── 1. config-layering：明文密码扫描 ───
withRoot((root) => {
  const bootstrap = path.join(root, "src", "main", "resources", "bootstrap.yml");
  fs.mkdirSync(path.dirname(bootstrap), { recursive: true });
  fs.writeFileSync(bootstrap, [
    "spring:",
    "  cloud:",
    "    nacos:",
    "      password: exampleHardcodedSecret42! # 明文密码",
    "      username: nacos",
    "      config:",
    "        server-addr: ${NACOS_HOST}",
    "  datasource:",
    "    password: ${DB_PASSWORD}           # 占位符，合规",
    "    username: realuser                 # 非敏感，但 username 也算",
  ].join("\n"));
  const files = configLayering.listConfigFiles(root);
  const issues = configLayering.scanPlaintextSecrets(files);
  const nacosPwd = issues.find((i) => i.key.includes("password") && i.value === "exampleHardcodedSecret42!");
  assert.ok(nacosPwd, "nacos.password 明文应被检测");
  const dbPwd = issues.find((i) => i.key.endsWith("datasource.password"));
  assert.ok(!dbPwd, "${DB_PASSWORD} 占位符不应报");
});

console.log("✅ config-layering：明文密码扫描（占位符豁免）通过");

// ─── 2. config-layering：bootstrap 识别 ───
withRoot((root) => {
  const bootstrap = path.join(root, "src", "main", "resources", "bootstrap.yml");
  fs.mkdirSync(path.dirname(bootstrap), { recursive: true });
  fs.writeFileSync(bootstrap, [
    "spring:",
    "  profiles:",
    "    active: ${PROFILES_ACTIVE:dev}",
    "  cloud:",
    "    nacos:",
    "      config:",
    "        server-addr: ${NACOS_HOST}",
    "        namespace: ${NACOS_CONFIG_NAMESPACE}",
    "        group: JH4J",
    "      shared-configs:",
    "        - dataId: app.yml",
  ].join("\n"));
  const layer = configLayering.detectBootstrapLayer(root);
  assert.ok(layer, "应识别 bootstrap");
  assert.strictEqual(layer.profile, "dev", "profile 默认值 dev");
  assert.strictEqual(layer.nacosAddr, "${NACOS_HOST}");
  assert.strictEqual(layer.group, "JH4J");
  assert.strictEqual(layer.sharedConfigs, true);
});

console.log("✅ config-layering：bootstrap 识别通过");

withRoot((root) => {
  const resources = path.join(root, "wl-produce-pl", "wl-produce-pl-service", "src", "main", "resources");
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, "bootstrap.yml"), [
    "spring:",
    "  profiles:",
    "    active: ${PROFILES_ACTIVE:dev}",
    "  cloud:",
    "    nacos:",
    "      config:",
    "        server-addr: ${NACOS_HOST}",
    "        namespace: ${NACOS_CONFIG_NAMESPACE:dev}",
    "        group: JH4J",
  ].join("\n"));
  fs.writeFileSync(path.join(resources, "application.yml"), [
    "server:",
    "  port: ${SERVER_PORT:10301}",
  ].join("\n"));
  const layer = configLayering.detectBootstrapLayer(root);
  assert.ok(layer && /wl-produce-pl-service/.test(layer.file), "应识别多模块 bootstrap");
  assert.strictEqual(configLayering.detectPort(root).port, 10301, "应识别多模块 application 端口");
  assert.strictEqual(readBootstrapProfile(root).profile, "dev", "doctor 应复用多模块配置发现");
});

console.log("✅ config-layering：多模块 bootstrap/application 发现通过");

assert.strictEqual(configLayering.checkPortRange("produce", 10301, 10301).ok, true, "env-matrix 冻结端口优先于通用范围");
assert.strictEqual(configLayering.checkPortRange("produce", 10201, 10301).ok, false, "端口必须与项目冻结值一致");
assert.strictEqual(configLayering.checkPortRange("produce", 10201).ok, true, "未声明冻结值时保留通用范围兼容行为");
console.log("✅ config-layering：项目冻结端口优先且保留通用范围兼容行为");

// ─── 3. env-matrix：加载/校验/迁移 ───
withRoot((root) => {
  const matrix = [
    "schemaVersion: 1",
    "project: wl-test",
    "module: test",
    "current: internal",
    "customers:",
    "  internal:",
    "    nacos:",
    "      host: \"nacos-internal:8848\"",
    "      username: \"nacos\"",
    "      namespaces:",
    "        dev: dev",
    "        sit: sit",
    "        uat: uat",
    "        pre: pre",
    "        prod: prod",
    "    datasource:",
    "      cluster: pt",
    "      type: mysql",
    "      dev:",
    "        host: \"db-dev-i\"",
    "        port: 3306",
    "        sid: \"hx_ptdb\"",
    "        username: \"ptuser\"",
    "      prod:",
    "        host: \"db-prod-i\"",
    "        port: 3306",
    "        sid: \"hx_ptdb\"",
    "        username: \"ptuser\"",
    "    redis:",
    "      dev:",
    "        host: \"redis-dev-i\"",
    "        port: 6379",
    "      prod:",
    "        host: \"redis-prod-i\"",
    "        port: 6379",
    "    k8s:",
    "      registry: \"harbor.i/hx\"",
    "      namespace: \"micro-services\"",
    "      port: 9101",
    "  huaxin:",
    "    nacos:",
    "      host: \"nacos-huaxin:8848\"",
    "      username: \"nacos\"",
    "      namespaces:",
    "        dev: dev",
    "        sit: sit",
    "        uat: uat",
    "        pre: pre",
    "        prod: prod",
    "    datasource:",
    "      cluster: pt",
    "      type: mysql",
    "      dev:",
    "        host: \"mysql.basic-services\"",
    "        port: 3306",
    "        sid: \"hx_ptdb\"",
    "        username: \"ptuser\"",
    "      prod:",
    "        host: \"mysql.basic-services\"",
    "        port: 3306",
    "        sid: \"hx_ptdb\"",
    "        username: \"ptuser\"",
    "    redis:",
    "      dev:",
    "        host: \"redis.basic-services\"",
    "        port: 6379",
    "      prod:",
    "        host: \"redis.basic-services\"",
    "        port: 6379",
    "    k8s:",
    "      registry: \"harbor.walsin.com.cn/hx\"",
    "      namespace: \"micro-services\"",
    "      port: 9101",
  ].join("\n");
  fs.mkdirSync(path.join(root, ".wl-skills-bd"), { recursive: true });
  fs.writeFileSync(path.join(root, ".wl-skills-bd", "env-matrix.yml"), matrix);

  const result = envMatrix.readMatrix(root);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
  assert.strictEqual(result.matrix.current, "internal");

  // 校验
  const errors = envMatrix.validateMatrix(result.matrix);
  assert.strictEqual(errors.length, 0, JSON.stringify(errors));

  // 迁移差异
  const diffs = envMatrix.computeMigrationDiff(result.matrix, "internal", "huaxin");
  assert.ok(diffs.length > 0, "internal → huaxin 应有差异");
  const nacosDiff = diffs.find((d) => d.field === "nacosHost" && d.env === "dev");
  assert.ok(nacosDiff, "nacosHost 差异");
  assert.strictEqual(nacosDiff.from, "nacos-internal:8848");
  assert.strictEqual(nacosDiff.to, "nacos-huaxin:8848");

  // 迁移计划
  const plan = envMatrix.buildMigrationPlan(root, { to: "huaxin" });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.from, "internal");
  assert.strictEqual(plan.to, "huaxin");
  assert.ok(plan.actions.length >= 21, "应生成 5×4+报告+矩阵更新");

  // 应用
  const applied = envMatrix.applyMigrationPlan(plan, { projectRoot: root, confirm: true, planHash: plan.planHash });
  assert.strictEqual(applied.ok, true);
  assert.ok(fs.existsSync(path.join(root, ".env.huaxin.dev")), "应生成 .env.huaxin.dev");
  assert.ok(fs.existsSync(path.join(root, "deploy/huaxin/k8s-configmap-dev.yaml")), "应生成 K8s ConfigMap");
  const deploymentDev = fs.readFileSync(path.join(root, "deploy/huaxin/k8s-deployment-dev.yaml"), "utf8");
  const deploymentProd = fs.readFileSync(path.join(root, "deploy/huaxin/k8s-deployment-prod.yaml"), "utf8");
  assert.match(deploymentDev, /:\$\{IMAGE_TAG\}/, "镜像版本必须由发布流水线注入，不得硬编码 latest/数字标签");
  assert.doesNotMatch(deploymentDev, /:latest\b/, "禁止 latest 镜像");
  assert.match(deploymentDev, /\/actuator\/health\/readiness/, "readiness 必须使用独立探针组");
  assert.match(deploymentDev, /\/actuator\/health\/liveness/, "liveness 必须使用独立探针组");
  assert.match(deploymentDev, /startupProbe:/, "慢启动必须由 startupProbe 保护");
  assert.match(deploymentDev, /runAsNonRoot: true/, "容器必须非 root");
  assert.match(deploymentDev, /readOnlyRootFilesystem: true/, "容器根文件系统必须只读");
  assert.match(deploymentProd, /kind: PodDisruptionBudget/, "生产部署必须包含 PDB");
  assert.match(deploymentProd, /kind: HorizontalPodAutoscaler/, "生产部署必须包含 HPA");
  const envDev = fs.readFileSync(path.join(root, ".env.huaxin.dev"), "utf8");
  assert.match(envDev, /NACOS_HOST=nacos-huaxin:8848/, "env 含 huaxin nacos");
  assert.match(envDev, /DB_HOST=mysql.basic-services/, "env 含 huaxin db");

  // 矩阵 current 更新
  const updatedMatrix = fs.readFileSync(path.join(root, ".wl-skills-bd", "env-matrix.yml"), "utf8");
  assert.match(updatedMatrix, /current: huaxin/, "矩阵 current 已更新为 huaxin");
});

console.log("✅ env-matrix：加载/校验/迁移差异/迁移应用通过");

// ─── 4. env-matrix：校验失败场景 ───
withRoot((root) => {
  const bad = [
    "schemaVersion: 2",
    "project: WL-Test",
    "module: test-mod",
    "current: nonexistent",
    "customers: {}",
  ].join("\n");
  fs.mkdirSync(path.join(root, ".wl-skills-bd"), { recursive: true });
  fs.writeFileSync(path.join(root, ".wl-skills-bd", "env-matrix.yml"), bad);
  const result = envMatrix.readMatrix(root);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.length >= 3, "schemaVersion/project 格式/current 不存在/customers 空 至少 3 个错误");
});

console.log("✅ env-matrix：校验失败场景通过");

// ─── 5. config-init：骨架生成 ───
withRoot((root) => {
  const plan = configInit.buildInitPlan(root, {
    project: "wl-sale",
    module: "sale",
    port: 10000,
    datasourceType: "mysql",
    customer: "internal",
  });
  assert.strictEqual(plan.ok, true);
  assert.ok(plan.actions.length >= 8, "bootstrap+application+logback+5×env+matrix+gitignore");
  const applied = configInit.applyInitPlan(plan, { projectRoot: root, confirm: true, planHash: plan.planHash });
  assert.strictEqual(applied.ok, true);
  assert.ok(fs.existsSync(path.join(root, "src/main/resources/bootstrap.yml")), "生成 bootstrap.yml");
  assert.ok(fs.existsSync(path.join(root, "src/main/resources/application.yml")), "生成 application.yml");
  assert.ok(fs.existsSync(path.join(root, ".env.dev.example")), "生成 .env.dev.example");
  assert.ok(fs.existsSync(path.join(root, ".env.prod.example")), "生成 .env.prod.example");
  assert.ok(fs.existsSync(path.join(root, ".wl-skills-bd/env-matrix.yml")), "生成 env-matrix.yml");
  const bootstrap = fs.readFileSync(path.join(root, "src/main/resources/bootstrap.yml"), "utf8");
  assert.match(bootstrap, /\$\{NACOS_HOST\}/, "bootstrap 用占位符");
  // 明文密码：password: 后面直接是非 ${ 开头的字面量（不是占位符）
  assert.doesNotMatch(bootstrap, /password\s*:\s*(?!\$)\S+/, "无明文密码（password 字段必须是占位符）");
  const app = fs.readFileSync(path.join(root, "src/main/resources/application.yml"), "utf8");
  assert.match(app, /port: \$\{SERVER_PORT:10000\}/, "application port 占位");
  const envProd = fs.readFileSync(path.join(root, ".env.prod.example"), "utf8");
  assert.match(envProd, /KNIFE4J_PRODUCTION=true/, "prod 关闭 knife4j");
  const envDev = fs.readFileSync(path.join(root, ".env.dev.example"), "utf8");
  assert.match(envDev, /KNIFE4J_PRODUCTION=false/, "dev 开启 knife4j");
});

console.log("✅ config-init：骨架生成（bootstrap/application/env×5/matrix/gitignore）通过");

// ─── 6. config-doctor：全链路体检 ───
withRoot((root) => {
  // 先 init
  const initPlan = configInit.buildInitPlan(root, { project: "wl-test", module: "test", port: 9101, datasourceType: "mysql", customer: "internal" });
  configInit.applyInitPlan(initPlan, { projectRoot: root, confirm: true, planHash: initPlan.planHash });
  // 故意加明文密码
  fs.appendFileSync(path.join(root, "src/main/resources/bootstrap.yml"), "\nspring:\n  redis:\n    password: plaintext123\n");

  const result = runConfigDoctor(root);
  assert.ok(result.checks.length >= 8, `至少 8 项体检，实际 ${result.checks.length}`);
  const secretCheck = result.checks.find((c) => c.id === "config-secret");
  assert.ok(secretCheck && !secretCheck.ok, "应检测到明文密码");
  const skeletonCheck = result.checks.find((c) => c.id === "config-skeleton");
  assert.ok(skeletonCheck && skeletonCheck.ok, "bootstrap 存在");
  const matrixCheck = result.checks.find((c) => c.id === "env-matrix");
  assert.ok(matrixCheck && matrixCheck.ok, "env-matrix 存在");
  const portCheck = result.checks.find((c) => c.id === "env-port");
  assert.ok(portCheck, "端口检查存在");
});

console.log("✅ config-doctor：全链路体检 L0~L8 通过");

// ─── 7. config-fix：明文密码修复 + 复扫 ───
withRoot((root) => {
  const bootstrap = path.join(root, "src", "main", "resources", "bootstrap.yml");
  fs.mkdirSync(path.dirname(bootstrap), { recursive: true });
  fs.writeFileSync(bootstrap, [
    "spring:",
    "  redis:",
    "    password: mySecretPass",
    "    host: redis-host",
    "  datasource:",
    "    password: dbPassword123",
  ].join("\n"));
  const plan = configFix.buildFixPlan(root);
  assert.ok(plan.summary.total >= 2, `至少 2 处明文，实际 ${plan.summary.total}`);
  assert.strictEqual(configFix.applyFixPlan(plan, { projectRoot: root, confirm: true }).reason, "plan-hash-mismatch");
  const applied = configFix.applyFixPlan(plan, { projectRoot: root, confirm: true, planHash: plan.planHash });
  assert.strictEqual(applied.ok, true);
  assert.strictEqual(applied.closure.remaining, 0, "复扫应 0 剩余");
  const fixed = fs.readFileSync(bootstrap, "utf8");
  assert.match(fixed, /\$\{REDIS_PASSWORD\}/, "redis 密码改为占位");
  assert.match(fixed, /\$\{DB_PASSWORD\}/, "db 密码改为占位");
  assert.doesNotMatch(fixed, /mySecretPass|dbPassword123/, "明文已清除");
});

console.log("✅ config-fix：明文密码修复 + 复扫验证通过");

// ─── 8. troubleshoot：故障诊断 ───
{
  const dbResult = troubleshoot.troubleshoot("Communications link failure");
  assert.strictEqual(dbResult.ok, true);
  assert.ok(dbResult.matched.some((m) => m.id === "db-connection"), "应匹配 db-connection");
  assert.match(dbResult.output, /telnet/, "应给出 telnet 排查步骤");

  const redisResult = troubleshoot.troubleshoot("Unable to connect to Redis");
  assert.strictEqual(redisResult.ok, true);
  assert.ok(redisResult.matched.some((m) => m.id === "redis-connection"));

  const nacosResult = troubleshoot.troubleshoot("NacosException");
  assert.strictEqual(nacosResult.ok, true);
  assert.ok(nacosResult.matched.some((m) => m.id === "nacos-connection"));

  const k8sResult = troubleshoot.troubleshoot("CrashLoopBackOff");
  assert.strictEqual(k8sResult.ok, true);
  assert.ok(k8sResult.matched.some((m) => m.id === "k8s-pod"));

  const noMatch = troubleshoot.troubleshoot("xxxxxxx-unknown-error-xxxxxxx");
  assert.strictEqual(noMatch.ok, false);
  assert.strictEqual(noMatch.reason, "no-match");

  const list = troubleshoot.listAllDiagnostics();
  assert.ok(list.length >= 8, `至少 8 个诊断项，实际 ${list.length}`);
}

console.log("✅ troubleshoot：DB/Redis/Nacos/K8s 诊断 + 无匹配兜底 + 列表通过");

// ─── 9. config-probe：TCP 探测（mock）───
{
  const { probeTcp, parseHostPort } = require("../lib/config-probe");
  // 无效地址应快速失败
  const r = probeTcp("127.0.0.1", 1); // 端口 1 通常拒绝
  // 异步，用 Promise 测
  r.then((result) => {
    assert.strictEqual(result.ok, false);
    assert.ok(["connection-refused", "timeout"].includes(result.reason));
  });
  const parsed = parseHostPort("nacos.basic-services:8848");
  assert.strictEqual(parsed.host, "nacos.basic-services");
  assert.strictEqual(parsed.port, 8848);
  const parsedUrl = parseHostPort("http://nacos:8848");
  assert.strictEqual(parsedUrl.host, "nacos");
  assert.strictEqual(parsedUrl.port, 8848);
}

console.log("✅ config-probe：TCP 探测 + 地址解析通过");

// ─── 10. 端到端：init → migrate → doctor 闭环 ───
withRoot((root) => {
  // init
  const initPlan = configInit.buildInitPlan(root, { project: "wl-prod", module: "mdm", port: 9101, datasourceType: "mysql", customer: "internal" });
  configInit.applyInitPlan(initPlan, { projectRoot: root, confirm: true, planHash: initPlan.planHash });

  // 手动补一个 huaxin 客户到 matrix（用纯缩进格式，parseYamlToObject 支持）
  const matrixFile = path.join(root, ".wl-skills-bd", "env-matrix.yml");
  const matrix = fs.readFileSync(matrixFile, "utf8");
  const withHuaxin = matrix + [
    "  huaxin:",
    "    nacos:",
    '      host: "nacos.basic-services"',
    '      username: "nacos"',
    "      namespaces:",
    "        dev: dev",
    "        sit: sit",
    "        uat: uat",
    "        pre: pre",
    "        prod: prod",
    "    datasource:",
    "      cluster: pt",
    "      type: mysql",
    "      dev:",
    '        host: "mysql.basic-services"',
    "        port: 3306",
    '        sid: "hx_ptdb"',
    '        username: "ptuser"',
    "      prod:",
    '        host: "mysql.basic-services"',
    "        port: 3306",
    '        sid: "hx_ptdb"',
    '        username: "ptuser"',
    "    redis:",
    "      dev:",
    '        host: "redis.basic-services"',
    "        port: 6379",
    "      prod:",
    '        host: "redis.basic-services"',
    "        port: 6379",
    "    k8s:",
    '      registry: "harbor.walsin.com.cn/hx"',
    '      namespace: "micro-services"',
    "      port: 9101",
    "",
  ].join("\n");
  fs.writeFileSync(matrixFile, withHuaxin);

  // migrate internal → huaxin
  const migratePlan = envMatrix.buildMigrationPlan(root, { to: "huaxin" });
  assert.strictEqual(migratePlan.ok, true);
  envMatrix.applyMigrationPlan(migratePlan, { projectRoot: root, confirm: true, planHash: migratePlan.planHash });

  // doctor 应识别 huaxin
  const doctorResult = runConfigDoctor(root);
  const matrixCheck = doctorResult.checks.find((c) => c.id === "env-matrix");
  assert.match(matrixCheck.detail, /current=huaxin/, "doctor 识别迁移后的 current");

  // 迁移报告存在
  assert.ok(fs.existsSync(path.join(root, "docs/config-migration-internal-to-huaxin.md")), "生成迁移报告");
});

console.log("✅ 端到端：init → 补客户 → migrate → doctor 闭环通过");

console.log("\n🎉 config-layering 全套测试通过（10 组覆盖 init/migrate/doctor/fix/troubleshoot/probe/端到端）");
