# 24 · 多环境与分支模型规范（✅ 已落地）

> 像 wl-skills-kit 一样，后端必须有标准化的环境分支模型，让同一份代码在不同环境构建出不同配置的应用。本规范把 mdm-service 的实际模式（`wl-mdm-{sit,uat,pre,prod}.yaml` + Nacos namespace）固化为团队基线。
>
> 强制度：🔴 必遵。
>
> **依据**：Spring Boot 官方 Profiles、Nacos 官方 Namespace 隔离、《项目开发手册》§"分支及版本管理"。

---

## 1. 环境矩阵

| 环境 | profile | Nacos namespace | 数据库 | 用途 | 写权限 |
|---|---|---|---|---|---|
| **dev** | dev | dev | dev/local | 本地开发 | 自由 |
| **sit** | sit | sit | sit | 联调测试 | 自由 |
| **uat** | uat | uat | uat | 用户验收 | 受控 |
| **pre** | pre | pre | pre（生产镜像）| 预发布 | 审批 |
| **prod** | prod | prod | prod | 生产 | 🔴 阻断 |

> **生产只读护栏**：codegen/safe-fix/permissions apply 在 `prod` 环境默认阻断，需 `WL_ALLOW_PRODUCTION_WRITES=true` 显式授权（详见 §6）。

## 2. 分支模型（《项目开发手册》§"分支及版本管理"）

```
master（生产，保护）
  ↑
pre（预发布，保护）
  ↑
uat（验收，保护）
  ↑
slt（系统联调）
  ↑
dev（开发集成分支）
  ↑
dev-{模块}-{工号}（个人开发分支）
```

| 分支 | 命名 | 权限 | 合并方向 |
|---|---|---|---|
| **master** | `master` | 技术经理保护 | pre → master（发布）|
| **pre** | `pre` | 技术经理保护 | uat → pre |
| **uat** | `uat` | 技术经理保护 | slt → uat |
| **slt** | `slt` | 模块负责人 | dev → slt |
| **dev** | `dev` | 模块负责人 | dev-{模块}-{工号} → dev |
| **个人** | `dev-{模块}-{工号}` | 个人 | 个人 → dev |

> 禁止跨级合并（如 dev → master 直推）；禁止 master/pre 直接提交，必须走 PR。

## 3. 环境配置标准结构

### 3.1 bootstrap.yml（环境无关，入口）

```yaml
spring:
  application:
    name: ${APP_NAME:wl-sale}
  cloud:
    nacos:
      config:
        server-addr: ${NACOS_HOST:nacos:8848}
        file-extension: yml
        group: JH4J
        shared-configs:
          - dataId: application-${spring.profiles.active}.yml
          - dataId: datasource-${DATASOURCE:oracle}-${spring.profiles.active}.yml
        namespace: ${NACOS_CONFIG_NAMESPACE}    # 按 profile 区分
      discovery:
        server-addr: ${spring.cloud.nacos.config.server-addr}
        namespace: ${NACOS_DISCOVERY_NAMESPACE}
  profiles:
    active: ${PROFILES_ACTIVE:dev}              # 默认 dev
```

### 3.2 环境特定配置（nacos dataId）

| dataId | 内容 | 示例 |
|---|---|---|
| `application-dev.yml` | 开发环境通用配置 | 日志 DEBUG、关闭熔断 |
| `application-uat.yml` | UAT 通用配置 | 日志 INFO、开启熔断 |
| `application-prod.yml` | 生产通用配置 | 日志 WARN、开启熔断 + 限流 |
| `datasource-oracle-dev.yml` | 开发 oracle 连接 | dev 库账号 |
| `datasource-oracle-prod.yml` | 生产 oracle 连接 | prod 库账号（独立加密）|

### 3.3 数据库集群归属（《项目开发手册》§"数据库划分"）

| 集群 | 库 | 用户 | 业务中心 |
|---|---|---|---|
| **cx**（产销）| `hx_cxdb1` | `cxuser` | 生产订单、品质、营销、成本、冷精 |
| **non_cx**（非产销）| `hx_non_cxdb2` | `nonuser` | 物流、计量、安全、安防、能源、环保、废钢 |
| **pt**（平台）| `hx_ptdb` | `ptuser` | 平台基础、用户、权限、字典 |

> 契约的 `dbCluster` 字段（cx/non_cx/pt）必须与实际 datasource profile 一致；doctor 体检校验。

## 4. 端口分配（《项目开发手册》§"业务模块端口划分"）

| 业务中心 | 端口范围 | 包名 |
|---|---|---|
| 销售 | 10000~10099 | `com.jhict.sale` |
| 质量 | 10100~10199 | `com.jhict.quality` |
| 生产 | 10200~10299 | `com.jhict.produce` |
| 成本 | 10300~10399 | `com.jhict.cost` |
| 安防 | 10400~10499 | `com.jhict.safe` |
| 设备 | 10500~10599 | — |
| 环保 | 10600~10699 | — |
| 计量物流 | 10700~10799 | — |
| 能源 | 10800~10899 | — |

> doctor 体检校验 `server.port` 在本模块端口范围内。

## 5. 配置加密（生产敏感信息）

```yaml
# ❌ 禁止：明文密码
spring:
  datasource:
    password: JinG@ng2025

# ✅ Nacos 配置加密 / 环境变量
spring:
  datasource:
    password: ${DB_PASSWORD}    # 由 K8s Secret 或 CI 注入
```

| 禁止 | 原因 |
|---|---|
| 明文密码进 git | 版本历史永久留痕，泄露即事故 |
| 明文密码进 nacos 明文 dataId | nacos 控制台可读 |
| 明文密码进 bootstrap.yml | 工程根目录，最先泄露 |

> 生产敏感信息用 Nacos 命名空间隔离 + K8s Secret + CI 注入环境变量。

## 6. 生产只读护栏（codegen/MCP/safe-fix）

| 工具 | dev/sit | uat | pre/prod |
|---|---|---|---|
| `codegen apply` | 确认后写 | 确认后写 | 🔴 阻断 |
| `safe_fix apply` | 确认后写 | 确认后写 | 🔴 阻断 |
| `permissions export apply` | 确认后写 | 确认后写 | 🔴 阻断 |
| `db preview` | 只读 | 只读 | 只读 |
| `validate` | 只读 | 只读 | 只读 |

**识别环境的方式**（优先级从高到低）：

1. `WL_PROJECT_ENV` 环境变量（bd 显式声明）
2. `SPRING_PROFILES_ACTIVE` 环境变量
3. `.wl-skills-bd/config.json` 的 `environment` 字段
4. `bootstrap.yml` 的 `spring.profiles.active`
5. 无法识别 → 默认按 `dev` 处理（不阻断）

**显式授权生产写入**：

```bash
# 本地显式开启（人工授权，记录审计日志）
$env:WL_ALLOW_PRODUCTION_WRITES = "true"
wl-skills-bd codegen apply wl-contract.json --plan-hash <hash> --confirm
```

> MCP/IDE 场景下，`allowProductionWrites` 参数必须由用户在 plan 评审后显式传递。

## 7. doctor 环境体检

doctor 新增 `env-config` 检测项：

| 检查 | 通过条件 | 失败修复 |
|---|---|---|
| `bootstrap.yml` 存在 | 有 `spring.profiles.active` | 创建 bootstrap.yml |
| Nacos 配置完整 | server-addr/namespace/group 齐全 | 补全 nacos 配置 |
| profile 在白名单 | dev/sit/uat/pre/prod 之一 | 修正 profile |
| 端口在模块范围 | `server.port` 在对应业务中心范围 | 修正端口 |
| 数据库归属一致 | datasource profile 与契约 dbCluster 一致 | 修正 datasource |
| 无明文密码 | datasource.password 用 `${...}` 占位 | 改环境变量 |
| 生产护栏 | 非 prod 或显式授权 | 确认环境 |

## 8. 环境与契约的关系

契约 `wl-contract.json` 可选声明 `environment` 字段：

```json
{
  "contractId": "sale-order-master",
  "environment": "dev",
  "dbCluster": "cx",
  ...
}
```

- 不声明：契约环境无关（默认，适用于所有环境）
- 声明 `dev`：仅 dev 环境生成，code generation 时校验当前环境匹配
- `dbCluster`：cx/non_cx/pt，doctor 校验与 datasource 一致

## 9. CI/CD 流水线模板

```yaml
# Jenkinsfile（按分支触发不同环境）
stages:
  - stage: Build
    branches:
      dev:       { profile: dev,  namespace: dev }
      slt:       { profile: sit,  namespace: sit }
      uat:       { profile: uat,  namespace: uat }
      pre:       { profile: pre,  namespace: pre }
      master:    { profile: prod, namespace: prod }
  - stage: Validate
    sh: |
      wl-skills-bd validate . --strict
      wl-skills-bd doctor
  - stage: CodegenCheck（非 prod）
    when: { branch: not master }
    sh: wl-skills-bd codegen plan wl-contract.json --json | jq '.summary | has("conflict") | not'
  - stage: Deploy
    prod: { manualApproval: true }   # master 必须人工审批
```

## 变更记录

- 2026-07-18 v0.11：新增多环境与分支模型规范，固化 mdm-service 的 Nacos 多 namespace 模式 + 手册分支模型 + 生产只读护栏。
