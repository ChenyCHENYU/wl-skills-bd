# Git Hook 接入（提交规范强制）

> **作用**：把 `standards/18-git-commit.md` 从"文字规范"变成"commit-msg hook 强制卡控"，对标 wl-skills-kit 的 husky + commitlint。
>
> 适用于任何 git 仓库（bd 仓库自身 + 业务工程）。

## 接入方式（bd 仓库自身 / Node 业务工程）

```bash
# 1. 装依赖
npm install -D husky @commitlint/cli @commitlint/config-conventional

# 2. 初始化 husky
npx husky init

# 3. 加 commit-msg hook（拷贝本目录的 commit-msg 到 .husky/）
cp .github/git-hooks/commit-msg .husky/commit-msg
chmod +x .husky/commit-msg   # Linux/Mac

# 4. 拷贝 commitlint 配置
cp .github/git-hooks/commitlint.config.js commitlint.config.js
```

之后每次 `git commit`，message 不符合 18-git-commit 格式会被 hook 拒绝。

## 接入方式（纯 Maven Java 工程，无 npm）

Java 工程可能没 package.json，用原生 git hook：

```bash
# 拷贝 commit-msg 到 .git/hooks/
cp .github/git-hooks/commit-msg .git/hooks/commit-msg
chmod +x .git/hooks/commit-msg
```

> 缺点：.git/hooks 不进版本控制，团队各人需各自装。
> 建议配合 Maven 的 `git-hooks-maven-plugin` 或 CI 流水线校验。

## 提交格式（两种合法形态）

```
形态 A（工具兼容，推荐）：
  feat(mdm): 模型属性管理-新增特征量分类 CRUD

形态 B（团队手册原文）：
  feat（mdm）：模型属性管理-新增特征量分类 CRUD
```

hook 强制形态 A（commitlint 原生），形态 B 靠 18-git-commit.md 人工约定。

## 类型清单（standards/18）

| code | 含义 |
|------|------|
| feat | 新功能 |
| fix | 修复 bug |
| perf | 性能优化 |
| docs | 文档 |
| style | 格式 |
| revert | 回滚 |
| chore/build/ci | 工程/构建/CI（commitlint 扩展）|
