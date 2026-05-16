---
name: business-doc-extract-be
description: |
  从既有后端代码（Controller / Service / Mapper XML / 表注释 / 字典）反向抽取业务文档，
  输出 docs/business/{module}.md，包含业务背景、字段语义、状态机、关键业务规则。
  典型触发：「接手陌生模块」「整理业务文档」「这模块业务是啥」「业务说明」
status: 🟡 骨架
stage: ②预 业务理解
---

# business-doc-extract-be

## Pre-flight 声明（必填）

```
🚀 已触发技能 business-doc-extract-be/SKILL.md
✅ 已读取 standards/index.md             → 仅用于结构理解，不写代码
```

## 前置检查

- [ ] 目标模块可定位（包路径 / 表名 / 接口路径任一）
- [ ] 表注释 / Entity Javadoc / 旧业务文档可参考

## 输入源（优先级）

1. **Controller**：`@ApiOperation` 描述 + 方法名动词
2. **Service 接口注释**：Javadoc / `@since`
3. **Entity / 表注释**：字段语义来源
4. **Mapper XML**：复杂查询揭示统计 / 报表口径
5. **常量类 / 枚举**：状态值与状态机
6. **既有业务文档**（如有）：交叉验证

## 产物模板

`docs/business/{module}.md`：

```markdown
# {模块} 业务说明 · 反向抽取 v{x.y}

## 1. 模块定位
- 业务领域：
- 上游 / 下游：
- 关键利益相关方：

## 2. 核心实体
- {Entity}：作用、生命周期

## 3. 字段语义
| 字段           | 类型        | 业务含义           | 取值范围 / 枚举         |
| -------------- | ----------- | ------------------ | ----------------------- |
| categoryCode   | String      | 分类编码（业务唯一） | 字母+数字，≤64        |
| status         | String      | 状态                | 0=待提交 1=审核中 2=已通过 |

## 4. 状态机
mermaid 状态图（如适用）

## 5. 关键业务规则
- 业务唯一性约束
- 跨表联动规则
- 软删除策略
- 租户隔离规则

## 6. 待确认事项
（标注 ⚠️，由业务侧确认）
```

## 约束

- **不改任何代码**
- 不确定的业务含义必须标 ⚠️，不要瞎猜
- 状态值若是数字字符串，必须从枚举类 / 常量类找到来源

## 完成摘要

```
✅ business-doc-extract-be 完成
   - 产物: docs/business/{module}.md
   - 抽取字段: N 个
   - 待确认 ⚠️: M 项
   - 下一步建议: ② api-design-be（如需重设计接口）
```
