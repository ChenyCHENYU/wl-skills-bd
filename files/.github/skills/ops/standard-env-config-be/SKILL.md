---
name: standard-env-config-be
description: |
  后端 Spring Boot + jh4j-cloud + Nacos + K8s 工程的环境配置标准化。
  覆盖：本地启动链（bootstrap.yml 占位符 + 本地变量模板 + 启动文档）、五环境部署清单（K8s yaml 齐全性 / 冲突检测 / 晋升梯队对齐 / ConfigMap 一致性）。
  目标：历史项目从 172 或其他内网/客户环境切换到华新时，clone 后配一下即可本地启动，推到 sit/uat/pre/prod 均可构建部署成功，无需手动逐文件改配置。
  典型触发：「标准化环境配置」「后端环境标准化」「切华新」「本地启动配不起来」「172 切华新」「K8s 部署清单」「补 pre 环境配置」「部署 yaml 对齐」
status: 🟡 骨架
stage: ops（横切，独立于代码生成 Pipeline ②-⑨）
risk: 🟡 中风险（写配置文件 + K8s manifest，需 dry-run + diff 预览 + 备份）
---

# standard-env-config-be

## 定位

把存量 jh4j-cloud 后端工程收敛到统一、可验证的环境结构，并在切换客户环境（172 内网 → 华新 / 其他客户）时自动对齐配置，不必手动逐文件改。

与前端 `wl-skills-kit/standard-env-config` **职责对称、对象不同**：

| 维度 | 前端 standard-env-config | 后端 standard-env-config-be（本 Skill）|
| --- | --- | --- |
| 标准化对象 | `.env` + `vite.config.*` | `bootstrap.yml` + K8s `{module}-*.yaml` |
| 环境真值来源 | 代码仓 env 文件 | **Nacos 配置中心**（代码仓只放连接引导 + 部署清单）|
| 环境集 | dev/sit/uat/pre/prd | sit/uat/pre/prod 四套 K8s + 本地启动 |
| 维度 | dev 模式 | datasource（oracle/mysql）+ 晋升梯队 |

> **核心认知**：后端运行时配置（DB 账密/Redis/业务参数）住在 **Nacos 配置中心**，不在代码仓。代码仓只负责两件事：① `bootstrap.yml` 引导连接 Nacos；② K8s yaml 把环境变量注入容器。本 Skill **只治理代码仓这两层 + 本地启动链**，不碰 Nacos 内配置、不碰业务代码、不碰镜像构建（Dockerfile / CI 流水线）。

## 能力边界

**会处理**：

- 每个可部署模块的 `src/main/resources/bootstrap.yml`（占位符结构、shared-configs 订阅）
- 每个可部署模块的 K8s 清单 `{module}-{sit,uat,pre,prod}.yaml`（ConfigMap + Deployment）
- 本地启动所需的环境变量模板与文档（连华新某环境 Nacos）
- git 冲突标记检测、死代码/失效配置检测、占位符漂移检测

**不会处理**：

- Nacos 配置中心内的 `application-*.yml` / `datasource-*.yml`（后端自行在华新 Nacos 维护）
- 业务代码、Java 源码、Mapper XML、SQL
- Dockerfile、`.gitlab-ci.yml`、镜像构建与推送（平台/运维层）
- 依赖版本、Maven 父 POM、锁文件

## 强制安全规则

1. 始终先扫描（只读），禁止凭项目名或口述直接写配置。
2. 华新项目必须由用户明确选择 `profile: walsin`；其他内网/客户项目必须提供完整四环境 Profile。不得静默套用华新地址。
3. 可部署模块出现多个候选或识别不到端口时，必须列出全部证据让用户确认，不得自动选定。
4. 首次执行只生成计划（dry-run），不写文件；必须用户确认目标地址、模块名、新增/更新/删除清单后才正式写入。
5. 正式写入前自动备份：Git 项目放 `.git/wl-skills-bd/standard-env/<timestamp>/`，非 Git 放系统临时目录。
6. **不打印 secret 明文**（`NACOS_PASSWORD`、DB 账密、集成 token），报告中只显示变量名与脱敏标记。
7. 任何写入后必须复扫，结果须为 `standard` 且无文件变更（幂等 no-op）。
8. K8s 部署策略段（affinity / toleration / nodeSelector）只做 diff 提示，不盲目改写集群策略。

## 标准流程

```text
scan（只读）
  → 识别可部署模块、bootstrap.yml 形态、四环境 yaml 齐全性、冲突标记、占位符漂移
  → 判定 standard / legacy-hardcoded / conflict-marked / incomplete-envs / custom / unsupported
  → 确认目标 Profile（walsin 或自定义）、每模块 datasource（oracle/mysql）、本地联调目标环境
  → plan（默认 dry-run，不写文件）
  → 用户确认：模块名、目标四环境地址、端口、新增/更新/删除清单、备份策略
  → apply（用户确认后正式写入 + 备份）
  → verify（静态校验：占位符完整、四环境齐全、无冲突、ConfigMap key 一致）
  → 再 plan，必须 no-op（幂等闭环）
```

## Pre-flight 声明

正式写入前必须向用户展示：

```
🚀 已触发技能 standard-env-config-be/SKILL.md
✅ 已读取 standards/01-toolchain.md     → 工具链/数据库类型检测基线
✅ 可部署模块（N）：{module1:port9101} / {module2:port9102} ...
✅ 目标 Profile：walsin / 自定义名称
✅ 四环境目标地址：sit=... / uat=... / pre=... / prod=...
✅ 每模块 datasource：{oracle|mysql}
✅ 文件计划：新增 N / 更新 N / 删除 N
✅ 备份位置：{path}
⚠️ 未打印任何 secret 明文
```

用户未明确确认时只允许停留在计划阶段。

## 可部署模块发现规则

一个工程可含 N 个可部署服务模块，标准化按模块逐个出计划。识别证据（缺一不可，多候选阻断让用户确认）：

1. 根 `pom.xml` 的 `<modules>` 列表
2. 子模块含 `spring-boot-maven-plugin` + `<packaging>jar</packaging>`（可打可执行 jar）
3. 子模块根有 `Dockerfile`（可部署标志）
4. `src/main/resources/bootstrap.yml` 存在（连接引导）
5. `containerPort` / K8s yaml 的端口

> 不满足 2/3 的模块（如 `-api` / `-entity` 纯依赖模块、不参与构建的旧目录）**不纳入标准化**，但若发现疑似死代码（不在 modules 内却带 yml）要单独提示。

## bootstrap.yml 占位符标准（最佳实践结构）

jh4j-cloud 体系所有工程同源（`jh4j-cloud-archetype-service` 生成），`bootstrap.yml` 应满足：

```yaml
spring:
  application:
    name: ${APP_NAME:xxx-service}      # 占位，不硬编码
  cloud:
    nacos:
      config:
        server-addr: ${NACOS_HOST:172.17.8.57}:${NACOS_PORT:8848}   # 地址+端口都占位
        file-extension: yml
        group: ${NACOS_GROUP:JH4J}     # group 占位
        shared-configs:
          - dataId: application-${spring.profiles.active}.${...}
          - dataId: datasource-${DATASOURCE:oracle}-${...}          # datasource 占位
        namespace: ${NACOS_CONFIG_NAMESPACE:uat}
      discovery:
        server-addr: ${spring.cloud.nacos.config.server-addr}
        namespace: ${NACOS_DISCOVERY_NAMESPACE:uat}
      username: ${NACOS_USERNAME:nacos}
      password: ${NACOS_PASSWORD:xxx}  # secret 占位，不落明文
  profiles:
    active: ${PROFILES_ACTIVE:uat}
```

> `${NACOS_HOST:172.17.8.57}` 的 172 默认值**是设计**：本地无环境变量时走内网兜底，线上由 K8s ConfigMap 注入华新地址覆盖。标准化**保留**这套占位符，不清除默认值。

### 漂移检测项（扫描时逐条标记）

| 检测项 | 规范 | 漂移示例 |
| --- | --- | --- |
| `spring.application.name` 硬编码 | 应 `${APP_NAME:...}` | 直接写 `name: jh4j-cloud-system` |
| 端口内联 | 应 `${NACOS_PORT:8848}` | 直接写 `:8848` |
| group 内联 | 应 `${NACOS_GROUP:JH4J}` | 直接写 `group: JH4J` |
| secret 明文 | 应占位 | `password: JinG@ng2025` |
| shared-configs 订阅 | 按项目保留各自 dataId（**不写死**）| mdm 带 `-aq-`、框架带 `seata-{profile}`，扫描保留 |

## K8s 四环境部署清单标准

每个可部署模块应有完整的 `{module}-{sit,uat,pre,prod}.yaml`，每个含 `ConfigMap + Deployment`（prod 补 `Service`）。随环境/客户变化的固定 key 集：

```
NACOS_HOST                # 五环境各不同（华新 IP/域名）
NACOS_USERNAME            # nacos
NACOS_CONFIG_NAMESPACE    # = 环境名
NACOS_DISCOVERY_NAMESPACE # = 环境名
PROFILES_ACTIVE           # = 环境名
DATASOURCE                # oracle | mysql（项目级，非环境级）
JAVA_OPTS                 # prod/pre 比 sit/uat 多 GC 日志参数
imagePullSecrets          # 客户级
image                     # {harbor}/{project}/{module}:{tag}
containerPort             # 模块固定
```

### 齐全性检测（必须）

- 四套环境 yaml 是否齐全（缺哪套明确报告）
- 是否含未解决的 git 冲突标记（`<<<<<<<` / `=======` / `>>>>>>>`）—— **🔴 阻断**
- ConfigMap key 集合是否跨环境一致

### 晋升梯队模板（最佳实践基线）

| 项 | sit / uat | pre / prod |
| --- | --- | --- |
| strategy | Recreate | RollingUpdate（maxSurge=1, maxUnavailable=0）|
| replicas | 1 | 2 |
| resources limits | cpu 1 / mem 2Gi | cpu 4 / mem 4Gi |
| resources requests | cpu 500m / mem 1Gi | cpu 500m / mem 1Gi |
| affinity | 无 | nodeAffinity(app=hx-business) + podAntiAffinity |
| tolerations | 无 | dm=hpa:NoSchedule |
| JAVA_OPTS | 基础 | 基础 + GC 日志 + HeapDump |
| readinessProbe | `{port}/actuator/health` | 同 |

> 梯队作为**对齐基线**，diff 差异逐项提示；集群特定策略（亲和/容忍）只报告不强改。

## 本地启动变量模板（切换华新的核心价值）

历史项目切华新后，本地启动走 bootstrap.yml 默认值会连到不可达的 172。标准化产出本地启动模板，覆盖固定词汇表（跨项目通用）：

```bash
# .env.local.example（华新 uat 联调示例，凭据走 secret 不落明文）
NACOS_HOST=http://10.216.163.36
NACOS_CONFIG_NAMESPACE=uat
NACOS_DISCOVERY_NAMESPACE=uat
PROFILES_ACTIVE=uat
DATASOURCE=mysql            # 按项目，mdm 部署用 mysql、本地直连可选 oracle
NACOS_USERNAME=nacos
NACOS_PASSWORD=__FILL_FROM_SECRET__
```

并产出本地启动文档（两种模式）：

| 本地模式 | 机制 | 适用 |
| --- | --- | --- |
| A. 连 Nacos 模式（默认）| bootstrap 默认值或 env 覆盖 → 连华新 Nacos → 配置从 Nacos 拉 | 日常开发 |
| B. 纯本地模式（`-Dspring.profiles.active=local`）| `bootstrap-local.yml` 禁 Nacos + `application-local.yml` 直连本地/华新 DB | 离线/调试 |

> 若工程内存在失效的 `application-local.yml`（不在构建路径、所在模块不在 modules 内），扫描单独标记为「疑似死代码」，由用户决定保留或删除。

## Profile 选择

- **华新项目**：显式 `profile: "walsin"`，内置四环境 Nacos/harbor/namespace 地址。
- **其他内网/客户项目**：传 `profileFile` 或 `profileData`，必须完整含 `sit/uat/pre/prod`。
- 不继承华新地址，未显式选择时只扫描不写。

## 业务模块端口段分配（团队开发要求）

> 依据《项目开发手册》§"业务模块端口划分"。`containerPort` / K8s yaml 端口属环境治理，归本 Skill。**生成或校验 K8s `containerPort` 时按段归属，防止跨业务域端口冲突。**

| 业务中心   | 端口段           |
| ---------- | ---------------- |
| 销售       | 10000 ~ 10099    |
| 质量       | 10100 ~ 10199    |
| 生产       | 10200 ~ 10299    |
| 成本       | 10300 ~ 10399    |
| 安防       | 10400 ~ 10499    |
| 设备       | 10500 ~ 10599    |
| 环保       | 10600 ~ 10699    |
| 计量物流   | 10700 ~ 10799    |
| 能源       | 10800 ~ 10899    |
| **MDM（待定）** | **待技术经理分配预留段（如 11000 ~ 11099）** |

### 端口校验规则

- 扫描 K8s yaml 的 `containerPort`，与上表段位比对：端口落在**非所属业务中心段**记为冲突提示
- 模块端口缺失时，**按本表所属业务中心段推荐一个空闲端口**，不跨段取值
- MDM 尚未分配正式段：本 Skill 检测到 MDM 工程端口时，仅记录"待登记"，不自动套用其他段
- 端口真值最终在 K8s ConfigMap / Deployment，`bootstrap.yml` 不含业务端口（仅 Nacos 8848）

> 端口属运维层，不写进 .java 代码；本表作为环境标准化的防冲突参照。

## 完成输出

```markdown
## 后端环境标准化结果
- 可部署模块（N）：{module1:port} / {module2:port}
- 项目形态：standard / legacy-hardcoded / conflict-marked / incomplete-envs
- Profile：walsin / 自定义名称
- datasource：{oracle|mysql}
- 文件计划：新增 N / 更新 N / 删除 N
- 冲突标记：0 / N（已阻断）
- 占位符漂移：已修正 N 项 / 仅提示 N 项
- 本地启动模板：已生成 .env.local.example + 启动文档
- 静态验证：通过 / 未通过
- 二次计划：无变更 / 仍有差异
- 备份位置：{path}（secret 均已脱敏）
```

完整 Profile 数据、晋升梯队细节和验收项见同目录 [USAGE.md](./USAGE.md)。
