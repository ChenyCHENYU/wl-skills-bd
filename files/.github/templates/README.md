# Java 代码模板（codegen 标准答案）

> **作用**：给 `service-codegen` / `entity-codegen` / `mapper-xml-gen` Skill 提供**可直接填空的标准骨架**，而非让 AI 从零发挥。
>
> 这是 bd 防"意大利面条代码"的核心物化层。对标 wl-skills-kit 的 `templates/`（45 个 Vue 模板）。
>
> **原则**：模板里的每一个写法都遵循团队 standards、实际 jh4j-cloud 基类和 OpenAPI 3 契约。生成时只填契约字段，不自由扩展结构。

## 模板清单（一文件一角色）

| 模板文件 | 角色 | 对应 Skill | 团队规范依据 |
|---------|------|-----------|-------------|
| `Entity.java.tmpl` | 数据库实体 | entity-codegen | standards/07 + CoreEntity |
| `CreateDTO.java.tmpl` | 新增入参（不含治理字段） | entity-codegen | standards/07 + 校验注解 |
| `UpdateDTO.java.tmpl` | 修改入参（id/revision 必填） | entity-codegen | standards/07 + Patch 语义 |
| `PageDTO.java.tmpl` | 分页查询条件 | entity-codegen | standards/07 |
| `VO.java.tmpl` | 详情响应出参 | entity-codegen | standards/07 + OpenAPI 3 |
| `PageVO.java.tmpl` | 分页列表出参 | entity-codegen | standards/07 + 最小暴露 |
| `Controller.java.tmpl` | REST 控制器 | service-codegen | standards/04 + 权限 |
| `Service.java.tmpl` | 业务 Service | service-codegen | standards/05 + JhServiceImpl |
| `Mapper.java.tmpl` | MyBatis 接口 | mapper-xml-gen | standards/06 + JhBaseMapper |
| `Mapper.xml.tmpl` | SQL 映射 | mapper-xml-gen | standards/06 + 禁 SELECT \* |
| `Migration.sql.tmpl` | Flyway 正向迁移 | db-migration | standards/12 + expand/contract |
| `Rollback.md.tmpl` | 人工恢复说明 | db-migration | standards/12 + 禁自动回滚 DDL |
| `ServiceTest.java.tmpl` | Service 单测 | unit-test-gen | standards/14 |
| `ControllerTest.java.tmpl` | Controller 协议测试 | unit-test-gen | standards/14 + ApiResult 2000 |
| `OperationRequestDTO.java.tmpl` | 批量/审批/状态机强类型请求 | entity/service-codegen | standards/04/07 + 输入边界 |
| `DdlPreview.md.tmpl` | DDL 风险、审批、验证与恢复评审报告 | db-migration | standards/12/21 |

## 填空变量约定

模板中用 `{{占位符}}` 表示生成时替换：

| 占位符 | 含义 | 示例 |
|--------|------|------|
| `{{rootPackage}}` | 工程根包 | `com.jhict.mdm` / `com.jhict.sale`（见 standards/02 包名映射）|
| `{{module}}` | 业务子域 | `feature` / `sourceData` |
| `{{Entity}}` | 实体类名（PascalCase）| `MdmFeatureCategory` |
| `{{entity}}` | 实体首字母小写 | `mdmFeatureCategory` |
| `{{table}}` | 表名（UPPER_SNAKE）| `MDM_FEATURE_CATEGORY` |
| `{{field}}` | 单个字段（按表循环）| `categoryCode` |
| `{{Field}}` | 字段首字母大写 | `CategoryCode` |
| `{{COLUMN}}` | 数据库列名 | `CATEGORY_CODE` |
| `{{apiDesc}}` | 接口中文名 | `特征量分类` |
| `{{permissionPrefix}}` | 权限码前缀 | `mdm_feature_category` |
| `{{pagePermission}}` 等 | 契约逐操作权限码 | `mdm_feature_category_query_page` |

`voFields`、`pageFields` 与 `displayFields` 均来自契约白名单；VO/PageVO 禁止通过继承 Entity 隐式扩展字段。

## 使用方式（codegen Skill 引用）

1. 编写并校验 `wl-contract.json`（schema：`.wl-skills-bd/schemas/contract.schema.json`）
2. 执行 `wl-skills-bd codegen plan wl-contract.json`，评审 15 个固定模板产物、按命令生成的 DTO、2 个协作契约产物与 `planHash`
3. 执行 `wl-skills-bd codegen apply wl-contract.json --plan-hash <hash> --confirm`
4. 执行 `wl-skills-bd validate`、Java/Maven 质量门和数据库人工 diff

协作产物不使用 Java 模板，但与源码处于同一个 codegen 计划：`docs/contracts/{contractId}.backend-contract.json` 供机器消费，`{contractId}.api.md` 供 `wl-skills-kit` 和人工评审；两者机器类型均为 `wl-api-contract`。

Service 与 ServiceTest 的 `<wl-custom>` 区用于补全 export、relation 和非确定性业务命令。生成器按 region name 保留区内内容，区外仍严格受管；不得删除、改名或嵌套标记。详情见 `.github/guides/frontend-backend-contract.md`。

模板由内置严格渲染器消费：缺变量、未闭合 section、非标量变量均直接失败。生成状态保存在 `.wl-skills-bd/.state/codegen-manifest.json`；本地修改会形成冲突并让整次 apply 零写入，只有显式 `--force` 才会在备份后覆盖。

## 与 standards 的绑定

模板是 standards 的**物化**。改模板前先确认 standards 是否需要同步改；standards 改了，对应模板的注释/结构也要跟。

## 官方/社区最佳实践引用

模板里固化的非团队规范部分，遵循：
- Oracle 字段用 `VARCHAR2(N CHAR)` —— CHAR 语义防多字节截断（Oracle 官方）
- Lombok `@Getter/@Setter/@Accessors(chain=true)` —— 链式调用（Lombok 官方）
- MyBatis-Plus `@Version` / `@TableLogic` 作为实体语义；业务写 SQL 另外显式同时约束租户、有效标记和 revision，不单独依赖插件
- `@Transactional(rollbackFor = Exception.class)` —— 显式回滚 checked 异常（Spring 官方）
- 构造注入 `@RequiredArgsConstructor` —— Spring 4.3+ 推荐
