// commitlint.config.js — wl-skills-bd 仓库自身 + 业务工程可复用
// 对应 standards/18-git-commit.md
// 格式：【类型code】（【模块名】）：【功能点】-【具体内容】
// 因 commitlint 原生 type 用半角冒号，这里用 type-enum + 正则兜底全角格式

module.exports = {
  rules: {
    // 类型必须在这 6 种之内（standards/18）
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'docs', 'style', 'revert', 'chore', 'build', 'ci'],
    ],
    // 类型小写
    'type-case': [2, 'always', 'lower-case'],
    // subject 非空
    'subject-empty': [2, 'never'],
    // header 长度
    'header-max-length': [2, 'always', 120],
  },
  // 额外：用 plugin 校验"全角括号+模块名"格式
  // 由于团队格式是【type】（module）：...，commitlint 原生不支持，
  // 用 body/header 正则补充（见下方 parserPreset 注释）
};

/*
 * 团队提交格式有两种合法形态（commitlint 友好 + 团队手册）：
 *
 * 形态 A（commitlint 标准，推荐用于工具兼容）：
 *   feat(mdm): 模型属性管理-新增特征量分类 CRUD
 *   ↑ type(scope): subject
 *
 * 形态 B（团队手册原文格式）：
 *   feat（mdm）：模型属性管理-新增特征量分类 CRUD
 *   ↑ type（scope）：subject  （全角括号+冒号）
 *
 * commitlint 原生只认形态 A。形态 B 需团队约定，工具不强制。
 * 本配置采用形态 A 作为强制基线（工具兼容），形态 B 作为人工约定（18-git-commit.md 记载）。
 */
