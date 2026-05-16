# wl-skills 生态分析报告 — 后端工作流落地建议

> **报告版本**：v0.0.1（随 `wl-skills-bd` 骨架同步发布）
> **作者**：CHENY（工号 409322）
> **目标读者**：团队 Leader / 后端核心成员 / AI 工作流维护者
> **基线项目**：`mdm-service` 仓库 `hx_test` 分支
> **重点回答**："`wl-skills-bd` 应如何衔接 `wl-skills-kit`，把后端开发动作真正落地？"

---

## TL;DR

1. **`wl-skills-ui` 已成熟**（L0-L4 完整、Skin/Native 双模、scanner + runtime + 模板齐全）→ **可冻结主版本，进入维护模式**。
2. **`wl-skills-kit` 已成熟到 v2.7.3**（L1-L5 全闭环、9 + 个 Skill 落地）→ **建议先稳定 1-2 个迭代再迁入 bd 协作功能**。
3. **`wl-skills-bd` 现仅为骨架 v0.0.1**：14 条 standards 中 6 条已落地内容（基于 `mdm-service` 真实代码反向沉淀）、9 个 SKILL 仅含 frontmatter + 流程纲要。**核心交付物 = 选 `mdm-service` 一个真实模块（推荐特征量分类）跑通 ②→⑨ 全链路 PoC，再批量推开**。
4. **外部 `CLAUDE规范文档` 不集成**：技术栈是 HZERO + DDD 四层 + 原生 MyBatis + Choerodon 权限，**与团队基线差异巨大**；我们已抽象其中的 **8 项共性最佳实践** 进入 `standards/`，差异点小节明确"以团队基线为准"。

---

## 1. `wl-skills-ui` 现状评估

### 1.1 关键事实

- 包 `@agile-team/wl-skills-ui`，版本看 `CHANGELOG.md`
- 设计分层 L0-L4：Design Tokens / Element Plus 适配 / Vendor 适配 / Layout / Runtime
- 提供 Native（原生 Element Plus）+ Skin（皮肤化）双模
- 完整包含：`scanner/` / `runtime/` / `skills/` / `standards/` / `templates/` / `mcp/` / `examples/` / `reference/`
- `tsup` 构建、`SKILL.md` 顶层入口、`design/` 与 `docs/` 完整

### 1.2 成熟度判断

✅ **生产就绪、稳定**。能给到设计令牌、组件适配、扫描与运行时校验、模板与示例的全套体系，且双模并行回应了"老项目改造 vs 新项目原生"的现实诉求。

### 1.3 建议

- **冻结主版本**：除安全修复 / 紧急适配新版 Element Plus，不再做架构级演进
- **维护工作回归到 scanner 规则与 templates 增量**
- **不要为了"和 bd 对齐"反向重构 ui**——它的领域与后端无重叠

---

## 2. `wl-skills-kit` 现状评估

### 2.1 关键事实（来自实际目录与 `AI工作流演进与多智能体协作交流文档.md`）

- 当前版本 **v2.7.3**
- `files/.github/` 完整：copilot-instructions.md + 14 条 standards + 多类 SKILL（core/sync/ops/domain）+ guides + reports
- `kit-internal/`：架构 ADR、CONTRIBUTING、MAINTAIN.md
- L1-L5 阶段全闭环：从业务理解 → API 契约 → 视图生成 → 菜单/权限/字典 sync → 审计/修复
- 多 AI 编辑器适配脚本（CLAUDE.md / AGENTS.md / .cursorrules / .windsurf / .clinerules / .kiro / .trae / Qoder 等多入口派生）
- MCP 集成、CLI（`wl-skills-kit init/update/diff/clean/check/...`）齐备

### 2.2 成熟度判断

✅ **已是当前阶段的"最佳实践版本"**。

要点支撑：

1. **架构闭环**：从入口→规范门控→Skill 注册表→产物契约→报告，整套语义级路由 + 懒加载机制非常成熟
2. **真实生产验证**：在多个业务前端工程跑过，有实际收益
3. **维护治理到位**：kit-internal 有 ADR / 维护手册，版本节奏稳定
4. **多 AI 编辑器适配**是行业内**很少有团队真做到的工程化能力**

### 2.3 风险与建议

- **风险点 1**：`copilot-instructions.md` 体量已不小，AI 单次加载成本在上升。建议 0.1.x 评估"模块化主入口"（按场景拆分）
- **风险点 2**：14 条 standards 高速演进，业务工程多分支同步策略需要 CLI 强化（参见 kit 的 `diff/check`）
- **建议**：**先稳定 1-2 个迭代再支持 bd 协作功能**（共消费 `api.md` / 权限码联动），避免同时多线引起破坏性变更

---

## 3. 后端工作流分析（基于 `AI工作流演进与多智能体协作交流文档.md` §5）

### 3.1 文档原意 10 步

```
① 业务理解（business-doc-extract-be）
② API 契约（api-design-be，消费前端 api.md）
③ 数据模型（entity-codegen）
④ 业务实现（service-codegen）
⑤ 数据访问（mapper-xml-gen）
⑥ 数据库迁移（db-migration，🔴 人工确认）
⑦ 单元测试（unit-test-gen）
⑧ 规范审计（convention-audit-be）
⑨ 自动修复（code-fix-be）
⑩ 输出与回归
```

### 3.2 与前端的协作面（重点）

| 协作产物                          | 前端来源                                    | 后端用途                                |
| --------------------------------- | ------------------------------------------- | --------------------------------------- |
| **`src/views/{module}/api.md`**   | wl-skills-kit `api-contract` Skill           | ② `api-design-be` 入参 + diff           |
| **`docs/business/{module}.md`**   | wl-skills-kit `business-doc-extract`         | ① 与 ④ 业务背景                         |
| **`SYS_PERMISSION_INFO.md`**      | wl-skills-kit `sync-permission`              | ⑧ `convention-audit-be` 权限码对账     |
| **错误码字典**                    | 双方共建                                     | ⑧ 审计 / 业务异常码                     |

> **关键判断**：`api.md` 是**前后端唯一双向契约**，必须以此为锚点；权限码统一为 `{module}_{resource}_{action}` 小写下划线，前端 `@CheckPermission('xxx')` 与后端 `@PreAuthorize('@pms.hasPermission(\\'xxx\\')')` 字符串完全一致。

### 3.3 文档原意中**没有提但应该补**的环节

- **AI 工具链前置检测**（JDK / Maven / Lombok）：已并入 `01-toolchain.md`
- **业务异常 / 日志 / 事务三专项审计**：已挂在 `convention-audit-be` 的检查项矩阵
- **DDL 强制人工卡口**：已写在 `db-migration` 与 `12-database-ddl.md`

---

## 4. `mdm-service` hx_test 分支事实清单

> 本节是后端 standards 与 SKILL 模板的**唯一真实代码出处**。

### 4.1 技术栈

| 维度        | 事实                                                |
| ----------- | --------------------------------------------------- |
| 框架        | Spring Boot + **jh4j-cloud 3.1.0**                  |
| ORM         | **MyBatis-Plus** (`JhBaseMapper<T>`)                |
| 数据库      | **Oracle / MySQL 双数据源**：Oracle 为 **mdm-service 专项**默认（`${DATASOURCE:oracle}`）；**团队其他主流业务项目以 MySQL 为主** |
| JDK         | 1.8                                                 |
| 模块拆分    | `jh4j-product-mdm-api/-entity/-service` 三模块      |
| 包根        | `com.jhict.mdm`                                     |
| 返回包装    | `ApiResult.success(message, data)`                  |
| 分页        | `JhPage<T>`                                         |
| 权限        | `@PreAuthorize("@pms.hasPermission('xxx')")`         |
| 工具        | Hutool 5.x / FastJSON 2.x / Hibernate Validator 6.x |
| Swagger     | Springfox + knife4j                                 |

### 4.2 真实代码片段（已抽进 standards）

- `MdmFeatureCategoryController.java` → 04-controller.md
- `MdmFeatureCategoryServiceImpl.java` → 05-service.md
- `MdmFeatureCategoryMapper.java/.xml` → 06-mapper-xml.md
- Entity / DTO / VO 全套 → 07-entity-dto-vo.md
- 包结构 → 02-project-structure.md

### 4.3 与外部 CLAUDE 规范的**关键差异**（已写入 standards 各小节）

| 维度      | 团队基线（mdm-service / jh4j-cloud）         | 外部 CLAUDE 规范（HZERO 1.11.4）                  |
| --------- | -------------------------------------------- | ------------------------------------------------- |
| 分层      | 三层 controller/service/mapper               | 四层 api/app/domain/infra（DDD）                  |
| ORM       | MyBatis-Plus `JhBaseMapper`                  | 原生 MyBatis + `BaseMapper`                       |
| 权限      | `@PreAuthorize("@pms.hasPermission('xxx')")` | `@Permission(level = ResourceLevel.ORGANIZATION)` |
| 返回      | `ApiResult.success(msg, data)`               | `Results.success(data)`                           |
| 路径风格  | 驼峰 `/mdmFeatureCategory/queryPage`         | kebab-case `/v1/{organizationId}/cy-contents`     |
| 主键      | 雪花 IdWorker（String）                      | Oracle 序列 + 触发器                              |
| 乐观锁    | `@Version` + `REVISION` 字段                 | `OBJECT_VERSION_NUMBER` + `@VersionAudit`         |
| 审计字段  | `CREATE_USER_NO/DATE_TIME` + EntityUtil 填充 | HZERO `AuditDomain` 自动                          |
| 软删除    | `IS_DELETE = 1/0` 业务维护                   | 不强制                                            |
| 租户字段  | `COMPANY_ID`                                 | `TENANT_ID` + 路径 `{organizationId}`             |

### 4.4 共性最佳实践（已抽进 standards，跨项目复用）

1. Controller→Service→Mapper 严格分层，禁止跨层
2. DTO/VO/Query/Entity 角色分离
3. 必填校验 `@NotBlank/@NotNull` + 全局异常处理器
4. SLF4J 占位符 + 级别分离 + 敏感打码
5. `@Transactional(rollbackFor = Exception.class)` + 收敛粒度
6. Mapper XML：禁 SELECT \*、动态条件、IN foreach、Oracle ROWNUM、LIKE CONCAT
7. Swagger `@Api/@ApiOperation/@ApiModelProperty`
8. 单测 `should_{result}_when_{condition}` 命名 + 覆盖率红线

---

## 5. `wl-skills-bd` v0.0.1 骨架交付清单

### 5.1 已交付文件

```
wl-skills-bd/
├── package.json                       (CLI bin 占位 + 版本 0.0.1)
├── .gitignore
├── README.md                          (~250 行，含技术栈基线 / Pipeline / 路线图)
├── CHANGELOG.md
├── bin/wl-skills-bd.js                (占位 CLI)
├── docs/
│   ├── analysis-report.md             (本文档)
│   └── roadmap.md
├── kit-internal/
│   ├── README.md
│   ├── architecture.md                (含 ADR-001 / 002 / 003)
│   └── CONTRIBUTING.md
└── files/.github/
    ├── copilot-instructions.md        (主入口，7 节)
    ├── guides/
    │   ├── usage.md
    │   └── architecture.md
    ├── reports/README.md
    ├── standards/                     (14 条)
    │   ├── index.md                   (✅)
    │   ├── 01-toolchain.md            (🟡)
    │   ├── 02-project-structure.md    (✅)
    │   ├── 03-naming.md               (🟡)
    │   ├── 04-controller.md           (✅)
    │   ├── 05-service.md              (✅)
    │   ├── 06-mapper-xml.md           (✅)
    │   ├── 07-entity-dto-vo.md        (✅)
    │   ├── 08-exception.md            (🟡)
    │   ├── 09-logging.md              (🟡)
    │   ├── 10-transaction.md          (🟡)
    │   ├── 11-security-permission.md  (🟡)
    │   ├── 12-database-ddl.md         (✅)
    │   ├── 13-api-doc-swagger.md      (🟡)
    │   └── 14-test-coverage.md        (🟡)
    └── skills/                        (9 个)
        ├── _registry.md
        ├── _pipeline.md
        ├── _best-practices.md
        ├── core/
        │   ├── api-design-be/SKILL.md
        │   ├── entity-codegen/SKILL.md
        │   ├── service-codegen/SKILL.md
        │   ├── mapper-xml-gen/SKILL.md
        │   ├── convention-audit-be/SKILL.md
        │   └── business-doc-extract-be/SKILL.md
        ├── data/db-migration/SKILL.md
        ├── test/unit-test-gen/SKILL.md
        └── ops/code-fix-be/SKILL.md
```

### 5.2 设计关键决策（详见 `kit-internal/architecture.md`）

- **ADR-001**：bd 独立于 kit 演进，不寄生
- **ADR-002**：以 `mdm-service` 为团队基线，CLAUDE 规范仅参考共性
- **ADR-003**：先骨架，跑通一个真实模块再细化模板

### 5.3 当前局限（用户必须知晓）

1. **CLI 未实现**：`init/diff/check` 都是占位，安装目前只能 `xcopy`
2. **9 个 SKILL 仅含流程纲要**：AI 触发时需要"按 mdm-service 真实代码风格倒推"，质量取决于 AI 模型与上下文
3. **MCP 未集成**：与 DB / Git / Jira 的实工具调用尚未接入
4. **未做对 mdm-service 的真实回归**：标准与 SKILL 是否在该工程一次跑通，需要 0.1.x PoC 验证

---

## 6. 后端工作流的核心建议

### 6.1 立刻可做（不需要 0.1.x）

1. **把 `wl-skills-bd/files/.github` 直接 xcopy 到 `mdm-service/.github`**
2. **触发任一 SKILL 实测**：例如让 Copilot 在 `mdm-service` 内说"帮我新增 `xxx` 模块的 service-codegen"
3. **基于实测结果修订 `standards/` 6 条已落地内容的偏差**

### 6.2 0.1.x 必做（PoC 阶段）

> **目标**：选 `mdm-service` 中**一个真实模块**跑通 ②→⑨ 全链路。推荐模块：**`MdmFeatureCategory`（特征量分类）**，因其 CRUD 完整、字段 ≤ 20、有状态语义、已有审计字段。

| 阶段           | 验证产物                                  | 验收标准                                   |
| -------------- | ----------------------------------------- | ------------------------------------------ |
| ② api-design-be | `docs/api/mdmFeatureCategory.md`         | 与现有 Controller 的实际接口 diff = 0      |
| ③ entity-codegen | `MdmFeatureCategory{,DTO,VO,PageDTO,PageVO}.java` | 与现有文件 diff 仅在 javadoc/格式      |
| ④ service-codegen | `MdmFeatureCategoryController/Service/ServiceImpl.java` | 同上                                      |
| ⑤ mapper-xml-gen | `MdmFeatureCategoryMapper.java/.xml`     | 同上                                      |
| ⑥ db-migration | `db/migration/V*__create_mdm_feature_category.sql` | 与生产表 DDL 字段集一致               |
| ⑦ unit-test-gen | `MdmFeatureCategoryServiceImplTest.java` | 单测 ≥ 6 个、覆盖率 ≥ 70%                  |
| ⑧ audit        | `reports/AUDIT_BE_*.md`                   | 真实 mdm-service 红/黄/绿数量与人审一致    |
| ⑨ code-fix-be  | 真实修复 mdm-service 一处违规             | diff 通过 review                            |

### 6.3 0.2.x 配套工程

- **CLI 实现**：`wl-skills-bd init/update/diff/check/doctor`
- **多 AI 编辑器适配派生**：`CLAUDE.md` / `AGENTS.md` / `.cursorrules` 等由主入口自动生成
- **MCP 集成**：DB 查询 / Git 状态 / Jira 任务详情，作为 SKILL 的工具入参

### 6.4 与前端 wl-skills-kit 的协作落地

| 联动点             | 实施建议                                                                          |
| ------------------ | --------------------------------------------------------------------------------- |
| `api.md` 双向契约  | kit 的 `api-contract` 输出格式作为 bd 的 `api-design-be` 输入；diff 报告必须包含字段类型 / 必填 / 权限码 |
| 权限码字典         | kit 的 `SYS_PERMISSION_INFO.md` 与 bd 审计联动，发现不一致直接红色阻断              |
| 业务文档共消费     | 同一份 `docs/business/{module}.md` 同时被前端 view-gen 与后端 service-codegen 消费 |
| 错误码             | 共建错误码字典，前后端各自审计本侧使用情况                                          |
| 多 AI 编辑器同步入口 | kit 的派生脚本可以复用到 bd（同样产出 `CLAUDE.md / AGENTS.md ...`），减少维护成本     |

---

## 7. 风险评估

| 风险                                                       | 等级 | 应对                                                                              |
| ---------------------------------------------------------- | ---- | --------------------------------------------------------------------------------- |
| SKILL 骨架质量不稳，AI 倒推 mdm-service 风格时偏差         | 🟡   | 0.1.x PoC 把模板补完整；标识"骨架阶段" 提醒用户                                  |
| DDL 误操作                                                  | 🔴   | 已设硬卡口：db-migration 必产 ROLLBACK + DDL_PREVIEW，AI 不直接执行              |
| 跨租户数据泄露                                              | 🔴   | 已写入 11-security-permission + 06-mapper-xml 审计项，audit 必扫 `COMPANY_ID` 缺失 |
| 前后端 api.md 错位                                          | 🟡   | api-design-be 必出 diff 报告 + 红色标注缺失项                                     |
| kit 与 bd 演进步调不一致导致集成痛点                       | 🟡   | 两包各自独立 changelog；共享契约（api.md 格式 / 权限码命名）由 ADR 锁定           |
| 工程师跨项目（jh4j-cloud vs HZERO）切换记忆混淆            | 🟢   | standards 每节有"与外部 CLAUDE 的差异"小节，明确以本基线为准                       |

---

## 8. 下一步建议（按优先级）

1. **本周**：把 `wl-skills-bd/files/.github` 复制到 `mdm-service/.github`，在 hx_test 分支让 Copilot/Cursor 实测一个 SKILL（推荐 `business-doc-extract-be` 最安全）
2. **下迭代**：跑通 `MdmFeatureCategory` 全链路 PoC，按 6.2 验收标准产出报告，修订 standards / SKILL 模板细节
3. **再下迭代**：实现 CLI `init/update/diff`；接入 MCP（至少 DB schema 查询）；产出与前端 kit 协同的 `权限码联动审计` 报告
4. **3 个迭代后**：bd 升级到 0.2.x；同步 kit 0.1.x 上线"共消费契约"
5. **持续**：维护 `kit-internal/architecture.md` ADR，每个破坏性变更必须留档

---

## 附录 A：本报告引用的关键文件

- `mdm-service/jh4j-product-mdm-service/src/main/java/com/jhict/mdm/controller/feature/MdmFeatureCategoryController.java`
- `mdm-service/jh4j-product-mdm-service/src/main/java/com/jhict/mdm/service/feature/impl/MdmFeatureCategoryServiceImpl.java`
- `mdm-service/jh4j-product-mdm-service/src/main/resources/mapper/feature/MdmFeatureCategoryMapper.xml`
- `mdm-service/pom.xml`
- `wl-skills-kit/AI工作流演进与多智能体协作交流文档.md` §5
- `CLAUDE规范文档/后端/CLAUDE.md`
- `CLAUDE规范文档/后端/development-standards.md`
- `wl-skills-ui/SKILL.md`、`wl-skills-ui/CHANGELOG.md`

## 附录 B：术语

- **L0-L4**：分层模型（参见 `files/.github/guides/architecture.md`）
- **api.md**：前后端共消费的接口契约
- **standards**：14 条规范条目，懒加载使用
- **SKILL**：可触发的工作流单元，9 个起步
- **PoC**：Proof of Concept，0.1.x 阶段用真实模块跑通验证

---

## 变更记录

- 2026-05-14 v0.0.1 初版（随骨架交付）
