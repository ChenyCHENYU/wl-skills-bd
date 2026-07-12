# 使用指南：后端环境标准化（standard-env-config-be）

把存量 jh4j-cloud + Spring Boot + Nacos + K8s 后端工程收敛到统一、可验证的环境结构，并在切换客户环境（172 内网 → 华新 / 其他客户）时自动对齐配置。

新项目继续从 `jh4j-cloud-archetype-service` 创建；存量项目通过本能力完成扫描、计划、备份、标准化、验证和幂等检查。

## 适用范围

- 工程根含 `pom.xml`，父 POM 指向 `jh4j-cloud`
- 至少一个可部署模块（`spring-boot-maven-plugin` + `Dockerfile` + `bootstrap.yml`）
- 使用 Nacos 做配置中心 + 服务发现
- 部署到 K8s（ConfigMap + Deployment 注入环境变量）

不符合上述形态的工程（纯库、非 jh4j-cloud、非 Nacos）返回 `unsupported`，不处理。

## 能力边界

会处理：

- `src/main/resources/bootstrap.yml`（占位符结构、shared-configs 订阅、secret 占位化）
- `{module}/{module}-{sit,uat,pre,prod}.yaml`（K8s ConfigMap + Deployment + Service）
- 本地启动所需的环境变量模板 `.env.local.example` 与启动文档
- git 冲突标记检测、占位符漂移检测、失效配置/死代码检测

不会处理：

- Nacos 配置中心内的配置（后端在华新 Nacos 自行维护 `application-*.yml` / `datasource-*.yml`）
- 业务代码、Java 源码、Mapper XML、SQL
- Dockerfile、`.gitlab-ci.yml`、镜像构建与推送（平台/运维层）
- 依赖版本、Maven 父 POM、锁文件

## 标准结构（迁移后的职责）

```text
工程根/
├── pom.xml                              modules 列表（标准化据此发现可部署模块）
└── {module}/                            每个可部署服务模块
    ├── Dockerfile                       镜像构建（不动）
    ├── pom.xml                          spring-boot-maven-plugin + finalName
    └── src/main/resources/
        └── bootstrap.yml                占位符完整的连接引导

工程根/{module}/                         K8s 部署清单（每环境一份）
├── {module}-sit.yaml
├── {module}-uat.yaml
├── {module}-pre.yaml
├── {module}-prod.yaml                   prod 含 Service

.env.local.example                       本地启动变量模板（华新/客户环境各一套）
docs/local-startup.md                    本地启动文档（两种模式）
```

> `bootstrap.yml` 内 `${NACOS_HOST:172.17.8.57}` 的 172 默认值**保留**——这是本地兜底设计，线上由 ConfigMap 注入覆盖。标准化不清除默认值，只确保差异点都用占位符、secret 不落明文。

## CLI 快速流程

> 🟡 CLI `standard-env` 子命令在 0.2.x 实现；当前骨架阶段由 AI 按 SKILL.md 流程读取文件、生成计划并执行。

```bash
# 1. 只读扫描（识别模块、形态、冲突、漂移）
wl-skills-bd standard-env scan

# 2. 华新项目生成迁移计划，不写文件
wl-skills-bd standard-env plan --profile walsin

# 3. 确认地址和文件计划后正式标准化（自动备份）
wl-skills-bd standard-env apply --profile walsin --confirm

# 4. 静态验证
wl-skills-bd standard-env verify --profile walsin
```

AI 对话最短提示词：

```text
用后端环境标准化能力检查当前工程并迁移到华新，先只生成计划，我确认后再写入并验证。
```

模块名或 datasource 不明确、目标不是华新时再补充：

```text
用 standard-env-config-be 标准化当前工程，目标华新 Profile；先 scan 和 plan，不要直接写入。
本地联调想连华新 uat 的 Nacos，datasource 用 mysql。
```

## 华新 Profile（walsin，内置）

华新项目显式使用内置 Profile：

```bash
--profile walsin
```

内置四环境 K8s 端点（来自 mdm-service 真实部署配置）：

| 环境 | NACOS_HOST | namespace | harbor project | imagePullSecret |
| --- | --- | --- | --- | --- |
| sit | `http://10.216.163.33` | sit | `hx-digital-sit` | `hx-digital-sit-wl` |
| uat | `http://10.216.163.36` | uat | `hx-digital-uat` | `hx-digital-uat-wl` |
| pre | `nacos.basic-services.svc.cluster.local` | pre | `hx-digital-pre` | `hx-digital-pre-wl` |
| prod | `nacos.basic-services` | prod | `hx-digital-prod` | `hx-digital-prod-wl` |

镜像前缀：`harbor.walsin.com.cn/{project}/{module}:{tag}`

> `DATASOURCE` 是**项目级**决定（mdm 部署用 mysql，其他项目可能 oracle），不属于 Profile。Profile 不固定 datasource，由用户在 plan 阶段确认。

## 自定义客户 Profile

其他内网/客户项目（如仍用 172 或第三方客户）使用完整 JSON，**不继承华新地址**：

```json
{
  "name": "lan-172",
  "title": "内网 172 环境",
  "environments": {
    "sit":  { "nacosHost": "http://172.17.8.57", "harborProject": "hx-digital-sit",  "imagePullSecret": "hx-digital-sit-wl"  },
    "uat":  { "nacosHost": "http://172.17.8.57", "harborProject": "hx-digital-uat",  "imagePullSecret": "hx-digital-uat-wl"  },
    "pre":  { "nacosHost": "http://172.17.8.57", "harborProject": "hx-digital-pre",  "imagePullSecret": "hx-digital-pre-wl"  },
    "prod": { "nacosHost": "http://172.17.8.57", "harborProject": "hx-digital-prod", "imagePullSecret": "hx-digital-prod-wl" }
  }
}
```

```bash
wl-skills-bd standard-env plan --profile-file ./env-profile.json
wl-skills-bd standard-env apply --profile-file ./env-profile.json --confirm
```

完整四环境是硬约束。缺任一环境、地址协议无效、含明文账密时阻断。

## 晋升梯队模板（K8s 对齐基线）

四环境 K8s yaml 的部署策略按晋升梯队差异化，作为最佳实践基线：

| 项 | sit / uat | pre / prod |
| --- | --- | --- |
| strategy | Recreate | RollingUpdate（maxSurge=1, maxUnavailable=0）|
| replicas | 1 | 2 |
| resources.limits | cpu 1 / mem 2Gi | cpu 4 / mem 4Gi |
| resources.requests | cpu 500m / mem 1Gi | cpu 500m / mem 1Gi |
| affinity | 无 | nodeAffinity(app=hx-business) + podAntiAffinity |
| tolerations | 无 | dm=hpa:NoSchedule |
| JAVA_OPTS | 基础 | 基础 + GC 日志 + HeapDump |
| readiness/livenessProbe | `{port}/actuator/health` | 同 |

> 集群特定策略（节点亲和 key/value、污点配置）只做 diff 报告，**不盲目改写**——这些依集群实际标签决定，标准化按 mdm-service 现网配置作为参考基线提示。

## 本地启动两种模式

### A. 连 Nacos 模式（默认，日常开发）

IDE 跑 Application 主类，靠 `bootstrap.yml` 默认值或环境变量连 Nacos，配置从 Nacos 拉。切华新后设环境变量覆盖 172 默认值：

```bash
# .env.local.example（华新 uat 联调）
NACOS_HOST=http://10.216.163.36
NACOS_CONFIG_NAMESPACE=uat
NACOS_DISCOVERY_NAMESPACE=uat
PROFILES_ACTIVE=uat
DATASOURCE=mysql
NACOS_USERNAME=nacos
NACOS_PASSWORD=__FILL_FROM_SECRET__
```

### B. 纯本地模式（离线/调试）

`-Dspring.profiles.active=local`，`bootstrap-local.yml` 禁 Nacos，`application-local.yml` 直连本地 Docker 库或华新 DB。

> 若 `application-local.yml` 所在模块不在根 `pom.xml` 的 `<modules>` 内（如 mdm-service 的 `jh4j-product-mdm-service` 旧目录），扫描会标记为「疑似死代码」，由用户决定保留或删除——它不参与构建、不生效。

## 漂移检测（扫描输出）

| 检测项 | 严重度 | 说明 |
| --- | --- | --- |
| git 冲突标记 `<<<<<<<` | 🔴 阻断 | 必须先人工解决 |
| secret 明文（password/账密） | 🔴 必修 | 占位化 |
| `spring.application.name` 硬编码 | 🟡 建议 | 应 `${APP_NAME:...}` |
| 端口/group 内联 | 🟡 建议 | 应占位化 |
| 四环境 yaml 缺失 | 🟡 必补 | 补齐对应环境 |
| ConfigMap key 跨环境不一致 | 🟡 必修 | 对齐 key 集 |
| 疑似死代码/失效配置 | 🟢 提示 | 用户决定 |

## 备份与回滚

- Git 项目：备份到 `.git/wl-skills-bd/standard-env/<timestamp>/`，不进提交。
- 非 Git 项目：备份到系统临时目录 `wl-skills-bd-standard-env/<project>-<timestamp>/`。
- 写入和删除事务式执行；静态验证失败自动恢复原文件。
- 输出只展示变量名与文件计划，**不打印 secret 值**。

## 验收清单

- [ ] 扫描结果为 `standard`
- [ ] 二次 `plan` 显示无文件变更（幂等）
- [ ] 每个可部署模块 `bootstrap.yml` 差异点全占位化、无 secret 明文
- [ ] 每个可部署模块四套 `{module}-{sit,uat,pre,prod}.yaml` 齐全、无冲突标记
- [ ] ConfigMap key 集合跨环境一致、值与目标 Profile 完全一致
- [ ] K8s 部署策略与晋升梯队基线一致（或差异已确认）
- [ ] 本地启动模板 `.env.local.example` 与启动文档已生成
- [ ] 疑似死代码已提示
- [ ] 备份完整、报告无 secret 明文
