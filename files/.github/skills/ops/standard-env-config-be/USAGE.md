# 使用指南：standard-env-config-be

> **v0.12 起，本 Skill 通过 `wl-skills-bd config` 命令族落地**。Skill 负责场景路由与安全边界，确定性执行复用 `config init/migrate/doctor/fix` 与 `troubleshoot`，不再维护第二套环境写逻辑。

## 已落地的等价命令（v0.12）

| 原 Skill 目标 | 等价命令 | 说明 |
|---|---|---|
| 生成环境配置骨架 | `wl-skills-bd config init` | bootstrap.yml + application.yml + logback + .env.example ×5 + env-matrix.yml |
| 配置合规检查 | `wl-skills-bd config doctor` | L0~L8 全链路体检（骨架/明文密码/占位符/矩阵/K8s/端口/一致性/生产护栏）|
| 客户迁移 | `wl-skills-bd config migrate --to <customer>` | 生成 .env + K8s ConfigMap/Secret/Deployment + 迁移报告 |
| 明文密码修复 | `wl-skills-bd config fix` | 自动改 ${VAR} 占位符 + 复扫验证 |
| 连通性探测 | `wl-skills-bd config doctor --probe` | DB/Redis/Nacos TCP 端口可达性 |
| 故障排查 | `wl-skills-bd troubleshoot "<错误>"` | 10 类故障诊断树 |

## 输入（config init/migrate 需要）

- 工程名（project）、业务模块（module）、端口（port）、数据源类型（oracle/mysql）
- 环境差异矩阵 `.wl-skills-bd/env-matrix.yml`（客户 × 环境的 nacos/datasource/redis/k8s/secrets）
- 真实 secret 只保存在受控 K8s Secret / Nacos / CI 平台，不进仓库

## 占位符铁律（config doctor 强制）

```yaml
# ✅ L1 代码库全占位（环境无关）
spring:
  cloud:
    nacos:
      config:
        server-addr: ${NACOS_HOST}
        namespace: ${NACOS_CONFIG_NAMESPACE}
        username: ${NACOS_USERNAME}
        password: ${NACOS_PASSWORD}

# ❌ 明文密码（config-secret error）
# password: JinG@ng2025
# password: ${NACOS_PASSWORD:JinG@ng2025}   # 默认值泄露
```

## 验收（config doctor 全绿）

- bootstrap.yml 存在 + profiles.active 声明
- 无明文敏感信息（config-secret）
- env-matrix.yml 存在 + current 客户有效
- Nacos 配置结构完整（server-addr/namespace/group/shared-configs）
- K8s ConfigMap 的 PROFILES_ACTIVE/NAMESPACE 合规
- 端口在模块范围（sale 10000-10099 等）
- 三方一致（bootstrap profile = env-matrix current = K8s PROFILES_ACTIVE）
- 连通性（可选 --probe）：DB/Redis/Nacos TCP 可达

详见 [standards/25 配置分层](../../standards/25-config-layering.md) 和 [standards/24 多环境](../../standards/24-multi-env.md)。

## 变更记录

- 2026-07-18 v0.12：本 Skill 目标已由 `config` 命令族落地；USAGE 改为指向 config 等价命令。
- 2026-07-17：骨架 USAGE（占位符示例 + 验收清单）。
