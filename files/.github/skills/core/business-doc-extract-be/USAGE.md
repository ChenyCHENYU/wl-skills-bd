# 使用指南：业务文档抽取（business-doc-extract-be）

> ⚠️ 当前 SKILL.md 仍为骨架。用于阅读旧代码反向产出业务说明。

## 触发词

```
后端业务沉淀 / 阅读旧代码生成业务说明 / 抽取业务文档
```

## 典型场景

### 场景 A：接手遗留模块

```
用户：帮我读懂 mdm-service 的 modelAttributeMap 模块在干什么
AI：  → 扫 Controller/Service/Mapper/Entity
      → 提取业务概念、状态机、字段语义、调用关系
      → 产出 docs/business/{module}.md（业务背景，供 api-design/codegen 复用）
```

## 预期产物

```
docs/business/{module}.md   ← 业务背景/字段语义/状态机
```

## FAQ

**Q：这和 api-design 什么关系？**
A：本 Skill 产出业务理解文档（输入），api-design/codegen 消费它生成契约和代码。

**Q：能替代人工理解业务吗？**
A：不能。AI 抽取的是代码层语义，业务背景/历史决策仍需人工补充。
