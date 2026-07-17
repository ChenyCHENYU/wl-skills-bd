# Java 代码模板（codegen 标准答案）

> **作用**：给 `service-codegen` / `entity-codegen` / `mapper-xml-gen` Skill 提供**可直接填空的标准骨架**，而非让 AI 从零发挥。
>
> 这是 bd 防"意大利面条代码"的核心物化层。对标 wl-skills-kit 的 `templates/`（45 个 Vue 模板）。
>
> **原则**：模板里的每一个写法都遵循 **官方/社区最佳实践 + 团队 standards 规范**（CoreEntity/JhServiceImpl/@Validated/Swagger/审计字段）。生成时只填业务字段，不动结构。

## 模板清单（一文件一角色）

| 模板文件 | 角色 | 对应 Skill | 团队规范依据 |
|---------|------|-----------|-------------|
| `Entity.java.tmpl` | 数据库实体 | entity-codegen | standards/07 + CoreEntity |
| `DTO.java.tmpl` | 请求入参 | entity-codegen | standards/07 + 校验注解 |
| `PageDTO.java.tmpl` | 分页查询条件 | entity-codegen | standards/07 |
| `VO.java.tmpl` | 响应出参 | entity-codegen | standards/07 + Swagger |
| `Controller.java.tmpl` | REST 控制器 | service-codegen | standards/04 + 权限 |
| `Service.java.tmpl` | 业务 Service | service-codegen | standards/05 + JhServiceImpl |
| `Mapper.java.tmpl` | MyBatis 接口 | mapper-xml-gen | standards/06 + JhBaseMapper |
| `Mapper.xml.tmpl` | SQL 映射 | mapper-xml-gen | standards/06 + 禁 SELECT \* |

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

## 使用方式（codegen Skill 引用）

1. Skill 读对应 `.tmpl` 文件
2. 按占位符替换
3. 字段块按 Entity 字段循环展开
4. 生成结果**必须**跑 `wl-skills-bd validate` 校验（P1-B）

## 与 standards 的绑定

模板是 standards 的**物化**。改模板前先确认 standards 是否需要同步改；standards 改了，对应模板的注释/结构也要跟。

## 官方/社区最佳实践引用

模板里固化的非团队规范部分，遵循：
- Oracle 字段用 `VARCHAR2(N CHAR)` —— CHAR 语义防多字节截断（Oracle 官方）
- Lombok `@Getter/@Setter/@Accessors(chain=true)` —— 链式调用（Lombok 官方）
- MyBatis-Plus `@Version` 乐观锁 + `@TableLogic` 软删（MP 官方）
- `@Transactional(rollbackFor = Exception.class)` —— 显式回滚 checked 异常（Spring 官方）
- 构造注入 `@RequiredArgsConstructor` —— Spring 4.3+ 推荐
