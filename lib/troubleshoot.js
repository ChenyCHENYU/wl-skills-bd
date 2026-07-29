"use strict";

// 故障排查诊断树（基于官方错误码 + 社区经验）
const DIAGNOSTICS = [
  {
    id: "db-connection",
    keywords: ["Communications link failure", "Connection refused", "connect timed out", "Cannot connect to", "ORA-12541", "ORA-12514", "ORA-12154", "Unknown database", "Access denied for user", "Login failed", "Public Key Retrieval", "Could not get JDBC Connection", "HikariPool-1 - Connection is not available"],
    title: "数据库连接失败",
    severity: "error",
    causes: [
      "DB 地址/端口错误（检查 DB_HOST/DB_PORT，或 nacos datasource-*.yml 的 url）",
      "DB 服务未启动（联系 DBA 确认服务状态）",
      "网络不通（VPN 未连/防火墙拦截/跨 namespace）",
      "账号密码错误（检查 DB_USERNAME/DB_PASSWORD，K8s Secret 是否正确挂载）",
      "SID/库名错误（Oracle 检查 DB_SID，MySQL 检查 url 的 dbname）",
      "连接池耗尽（HikariCP maximum-pool-size 太小或连接泄漏）",
    ],
    steps: [
      "1. 验证网络：telnet ${DB_HOST} ${DB_PORT} 或 nc -zv ${DB_HOST} ${DB_PORT}",
      "2. 检查 .env 或 K8s ConfigMap 的 DB_* 变量",
      "3. 查看 Nacos datasource-{env}.yml 的 spring.datasource.url",
      "4. 验证账号：用 DB 客户端（DBeaver/Navicat）直连测试",
      "5. 自动排查：wl-skills-bd config doctor --probe（TCP 探测 DB 端口可达性）",
      "6. Oracle 特有：检查 lsnrctl status（监听器是否注册了 SID）",
    ],
  },
  {
    id: "redis-connection",
    keywords: ["Unable to connect to Redis", "REDIS connection", "Cannot get Jedis connection", "Connection refused (redis)", "Redis connection failure", "NOAUTH Authentication required", "WRONGPASS"],
    title: "Redis 连接失败",
    severity: "error",
    causes: [
      "Redis 地址/端口错误（检查 REDIS_HOST/REDIS_PORT）",
      "Redis 服务未启动",
      "网络不通",
      "密码错误（检查 REDIS_PASSWORD，Redis 6+ 需 ACL 权限）",
      "Redis 持久化阻塞（fork 子进程时拒绝连接）",
    ],
    steps: [
      "1. 验证网络：telnet ${REDIS_HOST} ${REDIS_PORT}",
      "2. 检查 .env 或 nacos redis-{env}.yml 的 spring.redis.*",
      "3. 验证密码：redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} -a ${REDIS_PASSWORD} ping",
      "4. 自动排查：wl-skills-bd config doctor --probe",
    ],
  },
  {
    id: "nacos-connection",
    keywords: ["NacosException", "Unable to connect to Nacos", "Nacos connection", "ErrCode:500", "failed to req API", "subscribe error", "client not connected", "namespace not exist"],
    title: "Nacos 连接/配置失败",
    severity: "error",
    causes: [
      "Nacos 地址错误（检查 NACOS_HOST，K8s 内是服务名）",
      "Nacos 服务未启动或不可达",
      "namespace 错误（NACOS_CONFIG_NAMESPACE 不存在）",
      "账号密码错误（NACOS_USERNAME/NACOS_PASSWORD）",
      "group 错误（默认 JH4J，与 nacos dataId 的 group 不一致）",
      "dataId 不存在（application-{env}.yml / datasource-*.yml 未在 nacos 创建）",
    ],
    steps: [
      "1. 验证 Nacos 可达：浏览器访问 http://${NACOS_HOST}/nacos",
      "2. 检查 .env 或 K8s ConfigMap 的 NACOS_*",
      "3. 登录 Nacos 控制台，确认 namespace 存在 + dataId 在对应 group",
      "4. 检查 bootstrap.yml 的 shared-configs dataId 模式",
      "5. 自动排查：wl-skills-bd config doctor --probe",
      "6. K8s 内：kubectl exec 进 Pod，curl http://${NACOS_HOST}/nacos/v1/ns/operator/metrics",
    ],
  },
  {
    id: "nacos-auth",
    keywords: ["user not found!", "status=403", "no right", "Nacos 403", "authorization failed"],
    title: "Nacos 认证或命名空间授权失败",
    severity: "error",
    causes: [
      "启动进程没有继承 NACOS_USERNAME/NACOS_PASSWORD（IDEA 重启前仍使用旧环境）",
      "账号在目标 Nacos 实例不存在，或无目标 namespace/group 权限",
      "config 与 discovery 使用了不同 namespace/凭据",
      "凭据文件可解密，但未注入实际启动进程",
    ],
    steps: [
      "1. 先确认日志中的 Nacos 地址、namespace、group 与目标环境完全一致",
      "2. 在启动进程内仅检查变量是否存在和长度，禁止打印密码明文",
      "3. 用同一账号调用 Nacos 登录接口验证；403 user not found 先修账号/注入，不改业务代码",
      "4. Windows User 级变量变更后完全退出并重启 IDEA，再检查 Run Configuration 是否覆盖变量",
      "5. 分别核对 NACOS_CONFIG_NAMESPACE 与 NACOS_DISCOVERY_NAMESPACE；认证成功后再查服务注册",
    ],
  },
  {
    id: "k8s-pod",
    keywords: ["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "OOMKilled", "ContainerCreating", "Back-off restarting failed container", "no space left on device", "PodInitializing"],
    title: "K8s Pod 启动/运行失败",
    severity: "error",
    causes: [
      "镜像拉取失败（镜像仓库地址/凭据错误，检查 imagePullSecrets）",
      "OOMKilled（内存 limits 太小，调整 resources.limits.memory）",
      "启动超时（readinessProbe failureThreshold 太严，或应用启动慢）",
      "健康检查失败（/actuator/health 未就绪，应用未完全启动）",
      "磁盘满（no space left on device）",
      "ConfigMap/Secret 未挂载（envFrom 引用的 name 错误）",
    ],
    steps: [
      "1. kubectl describe pod <pod-name> -n <namespace>（看 Events）",
      "2. kubectl logs <pod-name> -n <namespace> --previous（看上次崩溃日志）",
      "3. kubectl get configmap <app>-cm -n <namespace> -o yaml（验证环境变量）",
      "4. kubectl get secret <app>-secret -n <namespace> -o yaml（验证密码挂载）",
      "5. 内存不足：调大 resources.limits.memory 或排查内存泄漏",
      "6. 镜像拉取：检查 harbor 凭据 + kubectl create secret docker-registry",
    ],
  },
  {
    id: "port-conflict",
    keywords: ["Port 8080 was already in use", "Port already in use", "BindException: Address already in use", "Web server failed to start", "LifecycleException"],
    title: "端口占用",
    severity: "error",
    causes: [
      "端口已被其他进程占用（本机残留 Java 进程）",
      "同 Pod 多容器端口冲突",
      "server.port 与 K8s containerPort 不一致",
    ],
    steps: [
      "1. Windows: netstat -ano | findstr :${PORT}；Linux: lsof -i:${PORT}",
      "2. 杀掉占用进程：taskkill /F /PID <pid>（Windows）/ kill -9 <pid>（Linux）",
      "3. 改端口：修改 .env 的 SERVER_PORT 或 application.yml 的 server.port",
      "4. 校验端口范围：wl-skills-bd config doctor（检查模块端口范围）",
    ],
  },
  {
    id: "bean-creation",
    keywords: ["BeanCreationException", "BeanDefinitionStoreException", "UnsatisfiedDependencyException", "NoSuchBeanDefinitionException", "Error creating bean with name", "Field required a bean"],
    title: "Spring Bean 创建失败",
    severity: "error",
    causes: [
      "依赖缺失（@Autowired 的 Bean 未声明/扫描不到）",
      "配置缺失（@Value/${...} 占位符在 nacos/env 都没声明）",
      "循环依赖（A 依赖 B，B 依赖 A）",
      "多数据源/多 Redis 配置冲突（@Primary 缺失）",
      "包扫描未覆盖（@ComponentScan basePackages 错误）",
    ],
    steps: [
      "1. 看完整 stacktrace 的 Caused by 链，定位是哪个 Bean",
      "2. 检查 @Value 占位符：grep -r \"@Value\" src/main，对照 .env/nacos",
      "3. 循环依赖：加 @Lazy 或重构",
      "4. 多数据源：确认 @DataSource/@Primary 注解正确",
      "5. 运行：wl-skills-bd doctor（检查配置完整性）",
    ],
  },
  {
    id: "runtime-classpath",
    keywords: ["ClassNotFoundException", "NoClassDefFoundError", "BooleanEnum", "Failed to read candidate component class", "Could not find class"],
    title: "编译通过但运行时类缺失",
    severity: "error",
    causes: [
      "直接依赖版本覆盖了团队父 BOM，框架 jar 与实际运行 jar 版本不兼容",
      "依赖被声明为 provided/test/optional，未进入 Spring Boot fat jar",
      "传递依赖被 exclude，或本地仓库存在不完整 jar",
      "IDEA classpath 与 Maven package 产物不一致",
    ],
    steps: [
      "1. 从最底层 ClassNotFoundException 确认缺失类和引用它的上游 jar",
      "2. mvn dependency:tree -Dverbose -Dincludes=<groupId>，检查版本仲裁、scope 和 omitted for conflict",
      "3. mvn help:effective-pom，确认该依赖是否应由 jh4j-cloud 父 BOM 管理；无书面依据不得在子模块私自锁版本",
      "4. jar tf <app.jar> 与 jar tf <dependency.jar> 核对缺失类是否真的进入运行包",
      "5. 执行 mvn clean package 后用打包产物启动冒烟；仅 compile 成功不能关闭此问题",
    ],
  },
  {
    id: "mybatis-mapper-binding",
    keywords: ["Invalid bound statement", "is not known to the MapperRegistry", "Type interface", "BindingException", "No qualifying bean of type", "Mapper method"],
    title: "MyBatis Mapper 扫描或 XML 绑定失败",
    severity: "error",
    causes: [
      "@MapperScan 使用了 com.xxx.** 这类 Ant 通配符；basePackages 只接受包前缀",
      "泛型基础 Mapper 被标注 @Mapper，MyBatis 尝试实例化未绑定泛型接口",
      "具体 Mapper 缺 @Mapper，且扫描器配置了 annotationClass=Mapper.class",
      "Mapper XML namespace 与 Java 接口全限定名不一致，或 XML 未进入 mapper-locations",
    ],
    steps: [
      "1. 运行 wl-skills-bd validate . --rules B26，先清零扫描和 namespace 偏差",
      "2. 使用精确前缀 @MapperScan(basePackages=\"com.example\", annotationClass=Mapper.class)，禁止 **",
      "3. 泛型 Mapper 契约不加 @Mapper；具体 Mapper 加 @Mapper",
      "4. 核对 XML <mapper namespace> 与接口全限定名逐字符一致",
      "5. Maven clean package 后启动验证 Mapper Bean 与首个查询，不能只看文件存在",
    ],
  },
  {
    id: "profile-inactive",
    keywords: ["No active profile set", "The following profiles are active", "Profile 'prod' could not be found", "cannot resolve placeholder", "Could not resolve placeholder"],
    title: "Profile/占位符未解析",
    severity: "error",
    causes: [
      "PROFILES_ACTIVE 未设置或值错误",
      "${VAR} 占位符在 env/nacos 都未声明（缺失必填配置）",
      "bootstrap.yml 加载失败（导致 nacos 配置未拉取）",
    ],
    steps: [
      "1. 检查 PROFILES_ACTIVE 环境变量或 bootstrap.yml 的 profiles.active",
      "2. 看 Caused by 里的 placeholder 名，在 .env/nacos 补声明",
      "3. 验证 bootstrap.yml 是否正确加载（看启动日志 'Adding bootstrap config'）",
      "4. 自动排查：wl-skills-bd config doctor",
    ],
  },
  {
    id: "idea-java-maven",
    keywords: ["JVM target 25", "指定的回退 SDK 版本", "package lombok does not exist", "package com.fasterxml.jackson", "command line is too long", "命令行过长", "不受支持的 JDK"],
    title: "IntelliJ JDK、Maven 导入或启动类路径配置错误",
    severity: "error",
    causes: [
      "Project SDK、Module SDK、Java Compiler target 与业务 POM 的 Java 8 基线不一致",
      "工程未按 Maven 项目重新导入，导致 Lombok/Jackson 等依赖整片标红",
      "Lombok 注解处理未启用",
      "Windows 启动 classpath 过长，Run Configuration 未启用缩短命令行",
    ],
    steps: [
      "1. 运行 wl-skills-bd doctor，核对 java、maven-java-target、idea-java-target 三项",
      "2. Project SDK/Module SDK/Maven importer/Java Compiler target 全部对齐业务 POM（jh4j-cloud 3.1 为 Java 8）",
      "3. 从根 pom.xml 重新加载 Maven，等待依赖索引完成；不要用 IDEA Build 错误代替 mvn compile 结论",
      "4. 启用 Lombok 插件与 Annotation Processing",
      "5. Run Configuration 的 Shorten command line 选择 JAR manifest 或 classpath file",
    ],
  },
  {
    id: "flyway-migration",
    keywords: ["FlywayException", "Migration of schema", "Validate failed", "Detected resolved migration not applied", "Detected applied migration not resolved", "Flyway migration failed", "SQL State"],
    title: "Flyway 迁移失败",
    severity: "error",
    causes: [
      "迁移脚本 checksum 不一致（脚本被修改）",
      "迁移脚本有语法错误",
      "迁移版本号冲突（V1 和 V1__a.sql / V1__b.sql）",
      "数据库已有数据冲突（NOT NULL 约束）",
      "权限不足（DB 账号无 DDL 权限）",
    ],
    steps: [
      "1. 看报错的 migration 版本号 + SQL State",
      "2. flyway repair（修复 checksum，仅开发环境）",
      "3. 检查 src/main/resources/db/migration 的版本号唯一性",
      "4. 人工修数据后 flyway baseline（生产慎用）",
      "5. 生成迁移：wl-skills-bd db preview <contract>",
    ],
  },
  {
    id: "feign-timeout",
    keywords: ["FeignException", "Read timed out", "connect timed out", "Service Unavailable", "com.netflix.client.ClientException", "Load balancer does not have available server"],
    title: "Feign/RPC 调用超时或失败",
    severity: "error",
    causes: [
      "下游服务未注册到 Nacos（discovery namespace 不一致）",
      "网络不通（跨 namespace 需 Service 名访问）",
      "超时配置不足（feign.client.config.read-timeout）",
      "下游服务熔断/降级",
      "服务名错误（@FeignClient(name=...) 拼错）",
    ],
    steps: [
      "1. 登录 Nacos 控制台，确认下游服务在同一个 discovery namespace 注册",
      "2. 检查 @FeignClient(name) 与 nacos 注册的服务名一致",
      "3. 增大 feign.client.config.{name}.read-timeout",
      "4. 加 fallbackFactory 降级（standards/22 §7）",
      "5. K8s 内：用服务名 ping，如 curl http://sale-service:10000/actuator/health",
    ],
  },
  {
    id: "mq-failure",
    keywords: ["MQBrokerException", "MQClientException", "RocketMQ", "KafkaException", "message send timeout", "No route info of this topic", "AMQP", "RabbitMQ"],
    title: "MQ 消息发送/消费失败",
    severity: "error",
    causes: [
      "MQ 服务不可达（地址/端口/网络）",
      "Topic 不存在（RocketMQ 需预先创建或 autoCreateTopicEnable）",
      "事务内发 MQ 导致不一致（standards/10 §7 + B20）",
      "消费幂等缺失导致重复消费",
      "消息体过大（RocketMQ 默认 4MB）",
    ],
    steps: [
      "1. 检查 mq-{env}.yml 的 producer/consumer 配置",
      "2. RocketMQ：mqadmin clusterList -n ${NAMESERVER} 验证集群",
      "3. 检查事务边界：@Transactional 内禁止发 MQ（B20 规则）",
      "4. 消费幂等：用业务键 + Redis 防重",
      "5. 运行：wl-skills-bd validate（检查 B20）",
    ],
  },
  {
    id: "rocketmq-illegal-message",
    keywords: ["CODE: 13", "the message is illegal", "JHCLOUD_FEIGN_INVOKE_TOPIC"],
    title: "RocketMQ Broker 拒绝非法消息",
    severity: "error",
    causes: [
      "消息体、属性名/属性值或 Topic 不符合 Broker 限制",
      "框架 Feign 调用审计消息包含空值、超长值或不可序列化内容",
      "客户端与 Broker 版本/限制不一致",
      "本地 Swagger 冒烟触发了非核心遥测消息，但业务请求本身可能已成功",
    ],
    steps: [
      "1. 记录 topic、keys、tags、消息体字节数和 Broker CODE，不记录令牌/密码/完整敏感载荷",
      "2. 对照 Broker 限制检查 topic、properties 与消息大小，确认目标 Topic 已创建",
      "3. 若来自框架 Feign 审计，先定位发送切面和具体字段；不要通过吞掉所有 MQ 异常掩盖业务消息失败",
      "4. 本地文档冒烟可在独立 local profile 精确关闭该遥测发送，SIT 正式联调仍须开启验证",
      "5. 服务启动成功、Nacos 注册、核心 API 与业务 MQ 分别验收，避免把后台遥测报错误判成启动失败",
    ],
  },
];

function findDiagnostics(keyword) {
  if (!keyword || typeof keyword !== "string") return [];
  const lower = keyword.toLowerCase();
  const matched = [];
  for (const d of DIAGNOSTICS) {
    const score = d.keywords.reduce((acc, k) => {
      if (lower.includes(k.toLowerCase())) return acc + (k.length > 10 ? 3 : 2);
      return acc;
    }, 0);
    if (score > 0) matched.push({ ...d, score });
  }
  matched.sort((a, b) => b.score - a.score);
  return matched.slice(0, 3);
}

function formatDiagnostic(d) {
  const lines = [
    `🔍 匹配诊断：${d.title}（置信度 ${d.score}）`,
    "─ 可能原因：",
    ...d.causes.map((c, i) => `  ${i + 1}. ${c}`),
    "─ 排查步骤：",
    ...d.steps.map((s) => `  ${s}`),
    "",
  ];
  return lines.join("\n");
}

function troubleshoot(keyword) {
  const matched = findDiagnostics(keyword);
  if (matched.length === 0) {
    return {
      ok: false,
      keyword,
      reason: "no-match",
      output: `🔍 未匹配到 "${keyword}" 的诊断。\n\n建议：\n  1. 提供更完整的错误信息（含 stacktrace 的关键行）\n  2. 运行 wl-skills-bd config doctor（环境体检）\n  3. 运行 wl-skills-bd config doctor --probe（连通性探测）\n  4. 查看常见诊断列表：wl-skills-bd troubleshoot --list\n`,
      matched: [],
    };
  }
  const output = matched.map(formatDiagnostic).join("\n");
  return { ok: true, keyword, matched: matched.map((m) => ({ id: m.id, title: m.title, score: m.score })), output };
}

function listAllDiagnostics() {
  return DIAGNOSTICS.map((d) => ({
    id: d.id,
    title: d.title,
    keywords: d.keywords.slice(0, 3),
  }));
}

module.exports = { DIAGNOSTICS, findDiagnostics, formatDiagnostic, listAllDiagnostics, troubleshoot };
