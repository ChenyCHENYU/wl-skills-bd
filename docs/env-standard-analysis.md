# 后端环境标准化能力需求基线（standard-env-config-be）

> **报告版本**：v0.0.1（随骨架同步）
> **作者**：CHENY（工号 409322）
> **目标读者**：后端核心成员 / AI 工作流维护者
> **基线项目**：`mdm-service` 仓库 `uat` 分支（已与华新 `origin` 对齐）
> **重点回答**：历史后端项目从 172 / 其他内网 / 客户环境切换到华新时，"`wl-skills-bd` 应标准化哪些配置、能力是否通用？"

---

## TL;DR

1. 后端配置与前端根本不同：**运行时配置住 Nacos 配置中心，代码仓只放连接引导（bootstrap.yml）+ 部署清单（K8s yaml）**。
2. `${NACOS_HOST:172.17.8.57}` 的 172 默认值**是设计**（本地兜底，线上 ConfigMap 覆盖），标准化**保留**，不清除。
3. CI/CD（Dockerfile / GitLab 流水线）是平台/运维层，**不在标准化范围**。
4. `bootstrap.yml` + Nacos + K8s（ConfigMap/Deployment）是 **jh4j-cloud 框架强制范式**（archetype 同源），**跨项目通用**，与模块数量无关。
5. 标准化只做两件事：① **本地启动链**（变量模板 + 启动文档 + 占位符检测）；② **五环境部署清单**（齐全 + 无冲突 + 晋升梯队对齐 + ConfigMap 一致）。

---

## 1. 后端三层配置模型（与前端的关键差异）

```
┌─────────────────────────────────────────────────────────┐
│ L3 运行时配置（Nacos 配置中心）← 不在代码仓，本 Skill 不碰 │
│   application-{profile}.yml / datasource-{type}-{profile}.yml
├─────────────────────────────────────────────────────────┤
│ L2 部署清单（代码仓 K8s yaml）← 本 Skill 治理           │
│   {module}/{module}-{sit,uat,pre,prod}.yaml             │
│   ConfigMap 注入环境变量 → 容器内覆盖 bootstrap 默认值   │
├─────────────────────────────────────────────────────────┤
│ L1 连接引导（代码仓 bootstrap.yml）← 本 Skill 治理      │
│   ${ENV:default} 占位符 → 本地走默认，线上被 L2 覆盖      │
└─────────────────────────────────────────────────────────┘
```

**运行链**：

- **线上（K8s）**：ConfigMap 注入 `NACOS_HOST=华新地址` → 覆盖 bootstrap 默认值 → 连华新 Nacos → 配置从 Nacos 拉 → jar 环境无关，四环境通吃。
- **本地启动**：无环境变量 → 走 bootstrap 默认值（172）→ 切华新后 172 不可达 → **起不来**。需设环境变量覆盖。

---

## 2. mdm-service 实测样本

mdm-service 是标准 jh4j-cloud 工程，含 **2 个可部署模块**，是标准化的真实 PoC 样本：

| 模块 | 端口 | bootstrap.yml | Dockerfile | K8s yaml |
| --- | --- | --- | --- | --- |
| `wl-mdm-service` | 9101 | ✅ 占位符完整 | ✅ | sit/uat/prod ✅、pre ⚠️冲突、dingtalk-pre ❌缺 |
| `wl-mdm-dingtalk-adapter` | 9102 | ✅ | ✅ | sit/uat/prod ✅ |

### 2.1 bootstrap.yml（占位符设计正确，是范本）

```yaml
server-addr: ${NACOS_HOST:172.17.8.57}:8848   # 地址占位，172=本地兜底
namespace: ${NACOS_CONFIG_NAMESPACE:uat}
password: ${NACOS_PASSWORD:JinG@ng2025}        # ⚠️ secret 明文（待占位化）
profiles.active: ${PROFILES_ACTIVE:uat}
shared-configs: application-{p} + datasource-{DATASOURCE:oracle}-aq-{p}
```

### 2.2 K8s yaml（已是华新，但有 3 个债）

- ✅ ConfigMap 已注入华新 Nacos（sit=`10.216.163.33`、uat=`10.216.163.36`、prod=`nacos.basic-services`）
- ✅ harbor/imagePullSecret 已华新（`harbor.walsin.com.cn/hx-digital-{env}-wl`）
- 🔴 **`wl-mdm-pre.yaml` 含未解决 git 冲突标记**（`<<<<<<< HEAD` / `>>>>>>> origin/sit`，wl-mdm 与 dingtalk 两套 yaml 撞车）
- ⚠️ dingtalk-adapter 缺独立 pre yaml（prod 里混了 pre 逻辑）
- ✅ 晋升梯队：sit/uat Recreate+1副本，prod RollingUpdate+2副本+反亲和+toleration

### 2.3 死代码发现

`jh4j-product-mdm-service/src/main/resources/`（`bootstrap-local.yml` + `application-local.yml` 含 172 Oracle 直连）**不在根 pom.xml 的 `<modules>` 内**（grep 确认零引用），不参与构建、不生效。标准化应识别并标记为「疑似死代码」。

---

## 3. 通用性证据：三方 bootstrap.yml 同源对比

| 元素 | archetype 模板（出厂） | mdm-service（业务） | jh4j-cloud-system（框架自带） |
| --- | --- | --- | --- |
| 模块结构 | `-api/-entity/-service` | 同 + dingtalk | `-service` 子模块 |
| `APP_NAME` | `${APP_NAME:demo}` 占位 | `${APP_NAME:wl-mdm}` 占位 | **硬编码** ⚠️ |
| `NACOS_HOST` | `${...:jh4j-nacos}` | `${...:172.17.8.57}` | `${...:jh4j-nacos}` |
| `NACOS_PORT` | 占位 | ⚠️ 内联 `8848` | `${...:8848}` |
| `NACOS_GROUP` | — | ⚠️ 内联 `JH4J` | `${...:JH4J}` |
| shared-configs | application + datasource | application + datasource(-aq-) | application + datasource + seata |
| DATASOURCE 默认 | mysql | oracle | oracle |
| K8s ConfigMap key 集 | — | 完全一致 | **完全一致** |

**结论**：所有团队后端项目从 `jh4j-cloud-archetype-service` 生成，结构同源。**框架强制统一范式，不是 mdm 特有**。未来大项目无论 1 个还是 20 个服务，每个可部署模块都是同一套结构。

### 同源但漂移的 3 类（标准化治理对象）

1. **shared-configs dataId 列表不同** → 标准化扫描保留各自订阅，不写死
2. **占位符精细度不同** → 检测「该占位却硬编码」（system 的 APP_NAME、mdm 的端口/group）
3. **K8s 环境注入风格不同** → mdm `envFrom` 整包 vs system 逐个 `configMapKeyRef`，都能跑，只报告不强改

---

## 4. 标准化对象（跨项目可扩展）

```
一个工程 = N 个可部署服务模块
每个模块 = 1 个 bootstrap.yml + M 套 K8s yaml（按环境）
标准化 = 遍历每个可部署模块 → 检测结构 → 按 Profile 填值
```

算法与模块数无关。mdm 是 2 个模块，未来 20 个同样遍历。

### 4.1 本地启动链（核心价值）

固定变量词汇表（跨项目通用）：

```
NACOS_HOST / NACOS_PORT / NACOS_GROUP
NACOS_CONFIG_NAMESPACE / NACOS_DISCOVERY_NAMESPACE
PROFILES_ACTIVE / DATASOURCE / NACOS_USERNAME / NACOS_PASSWORD
```

产出：`.env.local.example`（华新/客户各一套）+ 本地启动文档（连 Nacos / 纯本地两模式）。

### 4.2 五环境部署清单

固定 key 集（跨项目通用）：`NACOS_HOST / NACOS_USERNAME / NACOS_CONFIG_NAMESPACE / NACOS_DISCOVERY_NAMESPACE / PROFILES_ACTIVE / DATASOURCE / JAVA_OPTS / imagePullSecrets / image / containerPort`

检测项：齐全性 / git 冲突标记 / ConfigMap key 跨环境一致 / 晋升梯队对齐。

---

## 5. 华新 Profile（内置 walsin）

| 环境 | NACOS_HOST | namespace | harbor project | imagePullSecret |
| --- | --- | --- | --- | --- |
| sit | `http://10.216.163.33` | sit | `hx-digital-sit` | `hx-digital-sit-wl` |
| uat | `http://10.216.163.36` | uat | `hx-digital-uat` | `hx-digital-uat-wl` |
| pre | `nacos.basic-services.svc.cluster.local` | pre | `hx-digital-pre` | `hx-digital-pre-wl` |
| prod | `nacos.basic-services` | prod | `hx-digital-prod` | `hx-digital-prod-wl` |

镜像前缀：`harbor.walsin.com.cn/{project}/{module}:{tag}`

> `DATASOURCE` 是项目级决定，不属于 Profile。其他客户用完整 JSON，不继承华新地址。

---

## 6. 晋升梯队模板（K8s 对齐基线）

| 项 | sit / uat | pre / prod |
| --- | --- | --- |
| strategy | Recreate | RollingUpdate（maxSurge=1, maxUnavailable=0）|
| replicas | 1 | 2 |
| resources.limits | cpu 1 / mem 2Gi | cpu 4 / mem 4Gi |
| resources.requests | cpu 500m / mem 1Gi | cpu 500m / mem 1Gi |
| affinity | 无 | nodeAffinity(app=hx-business) + podAntiAffinity |
| tolerations | 无 | dm=hpa:NoSchedule |
| JAVA_OPTS | 基础 | 基础 + GC 日志 + HeapDump |
| probe | `{port}/actuator/health` | 同 |

集群特定策略（节点标签 / 污点）只 diff 提示，不盲目改写。

---

## 7. 与前端 wl-skills-kit/standard-env-config 的对照

| 维度 | 前端 standard-env-config | 后端 standard-env-config-be |
| --- | --- | --- |
| 标准化对象 | `.env` + `vite.config.*` | `bootstrap.yml` + K8s yaml |
| 环境真值来源 | 代码仓 env 文件 | Nacos 配置中心 |
| 环境集 | dev/sit/uat/pre/prd | sit/uat/pre/prod + 本地 |
| 安全模型 | dry-run + confirmApply + 备份 + 脱敏 | **同**（镜像）|
| Profile | walsin 内置 / 自定义 | **同** |
| 流程 | scan→plan→apply→verify→no-op | **同** |

复用前端的安全模型与闭环设计，适配后端对象。

---

## 8. 不做的事（能力边界）

- 不碰 Nacos 内配置（后端在华新 Nacos 自行建 `application-*.yml` / `datasource-*.yml`）
- 不碰 Dockerfile / `.gitlab-ci.yml` / 镜像构建（平台/运维层）
- 不碰业务代码 / Mapper XML / SQL / 依赖版本
- 不盲目改写集群策略（affinity/toleration 只 diff 提示）

---

## 9. PoC 验收路径

以 mdm-service 为样本，跑通标准 Skill 流程：

| 步骤 | 产物 | 验收 |
| --- | --- | --- |
| scan | 识别 2 模块、端口、四环境齐全性、pre 冲突、死代码、占位符漂移 | 报告准确 |
| plan (walsin) | 文件计划（补 dingtalk-pre、修 pre 冲突、占位化端口/group/secret） | 用户确认 |
| apply | 备份 + 写入 `.git/wl-skills-bd/standard-env/` | 无 secret 落明文 |
| verify | 四环境齐全无冲突、ConfigMap 一致、梯队对齐 | 通过 |
| 再 plan | no-op | 无文件变更 |

跑通后推广到团队其他 jh4j-cloud 后端工程。

---

## 变更记录

- 2026-07-12 v0.0.1 初版（随 `standard-env-config-be` 骨架交付）
