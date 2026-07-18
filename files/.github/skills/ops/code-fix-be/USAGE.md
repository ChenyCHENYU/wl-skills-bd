# 使用指南：安全修复闭环

## 1. 先扫描

```bash
wl-skills-bd validate src/main --strict
```

## 2. 只预览白名单修复

```bash
wl-skills-bd fix plan src/main --rules B3,B5 --json
```

重点检查：

- `actions[].edits` 是否只改报告位置；
- B3 是否引用现有 `BaseColumns`；
- B5 是否使用 Spring Transactional；
- `manual` 是否完整列出无法安全修改的项；
- `planHash` 和报告路径。

## 3. 显式应用

```bash
wl-skills-bd fix apply src/main --rules B3,B5 \
  --plan-hash <预览值> --confirm
```

文件在预览后发生变化时，旧 hash 自动失效，必须重新预览。工具不接受 `--force`，因为修复覆盖本地漂移没有安全语义。

## 4. 查看闭环证据

应用后自动生成 `reports/FIX_BE_<hash>.md`，包含：

- 修改清单；
- error/warn 前后矩阵；
- 选中规则残余；
- 新增回归；
- 无法自动修复的人工项。

`selectedOk=true` 仅表示本轮选中规则无残余/新增问题；`projectOk=true` 才表示项目全部 B 规则 error 已清零。两者不可混淆。

## FAQ

**为什么 B1/B4/B7/B8 不自动修？** 这些规则需要权限码、SQL 语义、租户架构或业务异常约定。机械替换可能把规范问题变成功能或安全事故。

**可以跳过复扫吗？** 不可以。复扫是 apply 内部步骤，不是可关闭选项。

**备份在哪里？** `.wl-skills-bd/.state/fix-backups/<backupId>/`，按原相对路径保存。
