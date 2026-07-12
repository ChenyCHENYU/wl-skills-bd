# 架构决策记录（ADR）

## ADR-001：建立 wl-skills-bd 作为后端 AI 工作流独立包

- **日期**：2026-05-14
- **状态**：accepted
- **背景**：`wl-skills-kit` 已稳定 v2.7.3 服务前端工作流；`wl-skills-ui` 稳定服务视觉/组件。后端缺少对等的 AI 工作流入口，AI 在后端项目中靠通用提示词工作，质量不稳定。
- **决策**：在 `wl-skills-kit` / `wl-skills-ui` 同级新增 `wl-skills-bd`，**不寄生于 kit**，独立演进。
- **理由**：
  1. **关注点分离**：前端规范与后端规范变化频率不同步
  2. **依赖最小化**：业务后端工程不应被迫安装前端 npm 包来读规范
  3. **复用形式一致**：与 kit/ui 一样采用 `.github/` 分发，多 AI 编辑器适配策略可复用
- **后果**：
  - +：后端有了对等的"主入口 → standards → SKILL → reports"完整闭环
  - +：可独立版本管理、独立 changelog
  - −：本包与 kit 必须保持"协作契约"同步（api.md / 权限码 / 业务文档命名），需在 0.1.x 提供同步检查脚本

## ADR-002：以 mdm-service 为团队基线，外部 CLAUDE 规范仅作参考

- **日期**：2026-05-14
- **状态**：accepted
- **背景**：`CLAUDE规范文档` 来自外部项目，技术栈是 HZERO 1.11.4 + 原生 MyBatis + Choerodon 权限 + DDD 四层。团队真实项目（`mdm-service` hx_test）用 jh4j-cloud 3.1.0 + MyBatis-Plus + `@PreAuthorize` + 三层。
- **决策**：
  - 共性最佳实践（分层、DTO/VO 分离、Mapper XML 硬规则、全局异常、日志占位符、事务、Swagger、单测红线）→ 抽象进 `standards/`
  - 具体代码模板（注解、返回包装、分页对象、权限注解）→ 全部对齐 `mdm-service`
- **理由**：(1) 工程已成型，DDD 四层改造成本不可接受；(2) MyBatis-Plus 已覆盖 Repository 接口需求；(3) 团队同事的肌肉记忆。
- **后果**：standards 文档保留"与 CLAUDE 规范的差异"小节，便于将来跨项目迁移时复用。

## ADR-003：9 个 Skill 起步，按 mdm-service 一个模块跑通后再细化模板

- **日期**：2026-05-14
- **状态**：accepted
- **背景**：一次性把 9 个 SKILL 都写到"可生产"质量风险大、易跑偏。
- **决策**：v0.0.1 仅交付 frontmatter + 流程纲要 + Pre-flight 占位；v0.1.x 选 `mdm-service` 一个真实模块跑完 ②→⑨ 全链路后再补完整模板与回归用例。
- **理由**：以真实代码反向校验模板，胜过纸面设计。
- **后果**：0.0.1 期间 AI 触发时会"按 mdm-service 真实代码风格倒推"，需要在 copilot-instructions.md §7 明确告知。

## ADR-004：新增 standard-env-config-be，横切 ops 类独立于代码生成主线

- **日期**：2026-07-12
- **状态**：accepted（扩展 ADR-003 的 Skill 集合，不推翻 ADR-003）
- **背景**：历史后端项目从 172 / 其他内网 / 客户环境切换到华新时，需手动逐文件改配置；后端配置与前端不同（运行时配置住 Nacos，代码仓只放 bootstrap.yml 引导 + K8s 部署清单），需要一套独立的环境标准化能力。
- **决策**：新增 `ops/standard-env-config-be`，作为横切 ops Skill，**不并入代码生成主线 ②-⑨**；与前端 `wl-skills-kit/standard-env-config` 职责对称、对象不同（后端管 bootstrap.yml + K8s yaml，前端管 .env + vite.config）。
- **理由**：(1) jh4j-cloud archetype 同源，bootstrap.yml + Nacos + K8s 是框架强制范式，跨项目通用；(2) 镜像前端已验证的安全模型（dry-run + confirm + 备份 + 脱敏 + 幂等）；(3) CI/CD 是平台层，明确不碰。
- **后果**：Skill 数 9 → 10；核心 Skill 集合扩展。CLI `standard-env` 子命令与 MCP 待 0.2.x；需求基线见 `docs/env-standard-analysis.md`。
