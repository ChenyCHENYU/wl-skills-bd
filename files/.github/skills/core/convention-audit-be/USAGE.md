# 使用指南：convention-audit-be

## 快速扫描

```bash
wl-skills-bd validate src/main
wl-skills-bd validate src/main --format markdown --output reports/AUDIT_BE.md
wl-skills-bd validate src/main --format sarif --output reports/backend.sarif
```

默认 error 返回非零；`--strict` 让 warning 也失败；`--quick` 跳过 B9~B12，只用于反馈迭代，不能替代最终全扫。

## 完整审计

1. `doctor` 检查 Java/Maven/Profile/质量配置和租户证据；
2. `validate` 跑 B1~B25；
3. `mvn verify -Pwl-quality` 跑 J1~J5/J8；
4. 如需 P3C 存量报告，单独激活 `wl-p3c-legacy`，不得和 PMD 7 profile 同时运行；
5. 核对运行时 OpenAPI/权限/前端契约；
6. 输出证据、严重度、责任边界和验证命令。

J7 是运行时文档能力，不应写成默认静态门禁；J6 是非阻断存量审计。

## 修复闭环

B3/B5 可先执行 `wl-skills-bd fix plan`；只有符合安全前置条件的项才能 apply。其他规则人工修复。任何方式修改后都必须重新执行全量 `validate` 与 Maven 质量门，并报告真实 remaining 数量。

## 报告原则

- 文件、行号、规则 ID、证据和稳定指纹齐全；
- 抑制项单独计数，不能从总量中静默消失；
- 不把 warning 包装成 error，也不把 J6/J7 写成默认阻断；
- 审计阶段只读，不因“发现问题”自动获得修复授权。
