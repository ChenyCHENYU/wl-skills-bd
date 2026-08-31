# 使用指南：integration-adapter-be

1. 从 `.wl-skills-bd/integration-adapters.example.json` 理解结构，在业务项目创建 `.wl-skills-bd/integration-adapters.json`；示例不默认启用。
2. 由平台团队登记真实 Maven 坐标、精确证据标记、方向门禁和可选项目模板。
3. binding 使用项目相对路径连接契约、源码、配置、测试与运行证据；运行证据文件必须非空，平台还可用 `runtimeEvidenceAnyOf` 指定部署号、观测时间等字面标记，避免空文件冒充证据。
4. 先执行 `integration adapters --module <module>`；缺口由平台描述符决定，BD 不补充主观规则。
5. 需要骨架时先 plan；apply 只能新增文件，之后继续 Maven 编译、测试和实际 Broker/HTTP 联调取证。

`review run --base origin/main` 用于增量反馈；默认 partial 会 fail-closed。只有项目在 `quality-gate.json` 明确允许 partial 时才可作为阶段门，合并/交付仍推荐运行不带 `--base/--staged/--quick/--rules` 的 full review。
