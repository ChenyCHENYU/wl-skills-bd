---
name: standard-env-config-be
description: |
  通过 config init/migrate/doctor/fix 与 troubleshoot 管理 jh4j-cloud/Nacos/K8s 多环境配置。
  典型触发：「后端环境标准化」「本地启动配置」「客户环境迁移」「K8s 清单对齐」「Nacos 占位符检查」
status: ✅ 落地
stage: ops（横切）
risk: 🟡 中风险
---

# standard-env-config-be

## Pre-flight 声明

```text
🚀 已触发技能 standard-env-config-be/SKILL.md
✅ 已读取 standards/24-multi-env.md 与 25-config-layering.md
✅ 已确认项目根、目标客户/环境和允许变更的配置范围
⚠️ doctor/troubleshoot 默认只读；init/migrate/fix 必须先预览并取得明确确认
```

## 路由

| 目标 | 命令 | 写入门 |
|---|---|---|
| 配置与明文凭据体检 | `wl-skills-bd config doctor` | 只读 |
| DB/Redis/Nacos 端口探测 | `wl-skills-bd config doctor --probe` | 只读；仅 TCP，不鉴权 |
| 生成标准骨架 | `wl-skills-bd config init ...` | 默认计划；apply 需相同 planHash + `--confirm` |
| 客户/环境迁移 | `wl-skills-bd config migrate --to <customer> --plan` | apply 需相同 planHash + `--confirm` |
| 明文密码改占位符 | `wl-skills-bd config fix` | 默认预览；apply 需相同 planHash + `--confirm`，写后复扫 |
| 常见启动/部署故障 | `wl-skills-bd troubleshoot "<错误>"` | 只读 |

## 强制边界

- L1 代码仓库只存 `${VAR}` 占位符；真实 secret 仅在 K8s Secret/Nacos/CI/受控 `.env`。
- 不读取或修改 Nacos 服务端内容，不持有数据库/K8s/Nacos 写凭据，不自动部署。
- `env-matrix.yml` 是客户×环境差异的单一事实源；bootstrap、K8s 与矩阵必须一致。
- init/migrate/fix 必须先 plan，plan 纳入当前文件哈希；apply 前重算并核对 planHash，原子写失败必须回滚，不能留下半套文件。
- `pre/prod/production` 默认阻断上述写入；显式授权仅覆盖工程文件，不覆盖 Nacos/K8s/数据库外部写入。
- 所有报告脱敏；不得在日志、Markdown、命令示例或测试夹具中写入真实 token/密码。
- 结束前运行 `config doctor`；未全绿项必须给出证据、影响和人工下一步，不得宣称完成。

完整参数与验收清单见同目录 `USAGE.md`。
