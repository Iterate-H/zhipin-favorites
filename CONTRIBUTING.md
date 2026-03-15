# 贡献指南

感谢你对本项目的关注！无论是报 bug、提建议还是贡献代码，都非常欢迎。

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [Issue 规范](#issue-规范)
- [Pull Request 流程](#pull-request-流程)
- [开发环境](#开发环境)
- [代码规范](#代码规范)
- [贡献者层级](#贡献者层级)

---

## 行为准则

- 尊重每一位参与者，保持友善和建设性的沟通
- 不接受人身攻击、骚扰、歧视等行为
- 聚焦问题本身，对事不对人

## 如何贡献

### 不写代码也能贡献

- **报告 Bug**：Boss直聘经常改版，如果脚本不工作了，提一个 Issue 就是很大的帮助
- **提交建议**：想要新功能？想支持更多页面？开一个 Feature Request
- **改进文档**：发现 README 有错或不清楚的地方，直接提 PR
- **帮忙测试**：在不同浏览器/油猴扩展下测试并反馈结果

### 写代码贡献

1. Fork 本仓库
2. 创建你的分支：`git checkout -b feat/你的功能名`
3. 修改代码并测试
4. 提交：`git commit -m "feat: 简要描述"`
5. 推送并创建 Pull Request

## Issue 规范

### 提交 Bug 时请包含

- **脚本版本**（打开脚本看 `@version`）
- **浏览器 + 油猴扩展**（如 Chrome 131 + Tampermonkey 5.3）
- **出问题的页面**：收藏页还是搜索页？URL 长什么样？
- **具体表现**：按钮没出现？导出卡住？数据缺失？
- **控制台报错**：按 F12 打开控制台，截图错误信息

### 提交功能建议时请说明

- 你想解决什么问题
- 你期望的效果是什么
- 如果可以，描述一下你设想的实现方式

### Label 说明

| Label | 含义 |
|-------|------|
| `bug` | 功能异常 |
| `enhancement` | 新功能或改进 |
| `platform-change` | Boss直聘改版导致的适配问题 |
| `good first issue` | 适合第一次贡献的简单任务 |
| `help wanted` | 需要社区帮助 |
| `needs-info` | 需要更多信息 |
| `duplicate` | 重复问题 |
| `wontfix` | 不会修复（附理由） |

## Pull Request 流程

### PR 检查清单

提交 PR 前请确认：

- [ ] 在 Boss直聘收藏页和搜索页都测试过
- [ ] 没有破坏已有功能（导出、中断续抓、翻页）
- [ ] 代码风格与现有代码一致
- [ ] PR 标题简明扼要，描述中说明了改了什么、为什么改

### 分支命名

| 类型 | 格式 | 例子 |
|------|------|------|
| 新功能 | `feat/简要描述` | `feat/export-csv` |
| Bug 修复 | `fix/简要描述` | `fix/pagination-broken` |
| 文档 | `docs/简要描述` | `docs/update-readme` |
| 适配 | `adapt/简要描述` | `adapt/new-card-layout` |

### Commit 格式

```
类型: 简要描述

类型可选值：
- feat: 新功能
- fix: 修复
- adapt: 平台适配
- docs: 文档
- refactor: 重构
- chore: 杂项
```

### 审核流程

1. 提交 PR 后，维护者会在 **3 个工作日内**做首次回复
2. 可能会要求修改——这很正常，不代表否定你的工作
3. 通过审核后合并到 `main`

## 开发环境

### 最低要求

- 浏览器：Chrome / Edge / Firefox（最新版）
- 油猴扩展：[Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
- Boss直聘账号（需要登录才能访问收藏和搜索）

### 本地开发步骤

1. Fork 并 clone 仓库
2. 在 Tampermonkey 中新建脚本，把 `zhipin_export.user.js` 内容粘贴进去
3. 修改代码后，刷新 Boss直聘页面即可测试
4. 按 F12 打开控制台，查看 `[zhipin导出]` 开头的日志

### 调试技巧

- 脚本在 `document-start` 阶段注入，XHR 拦截必须在页面加载前生效
- `window.__ZE_JOB_INFO__` 存储了最近一次抓取的详情数据，可以在控制台直接查看
- IndexedDB 中的 `zhipin_export_v5` 数据库存储了会话状态，可在 DevTools → Application 中查看
- 如果测试翻页功能，建议收藏 20+ 岗位以产生多页数据

## 代码规范

- 缩进：2 空格
- 字符串：单引号
- 变量命名：驼峰（`camelCase`）
- 中文字段名保持中文（如 `岗位名称`、`薪资`），这些是面向用户的导出列名
- 新增 DOM 选择器时，写注释说明对应 Boss直聘的哪个页面元素
- 不引入额外的外部依赖（当前仅依赖 SheetJS/xlsx）

## 贡献者层级

### 贡献者（Contributor）

- **条件**：至少 1 个 PR 被合并，或提交过有效 Bug 报告
- **权限**：出现在 README 的贡献者列表中

### 协作者（Collaborator）

- **条件**：持续贡献 3+ 个 PR，或主动维护某个功能模块（如平台适配）
- **权限**：Issues triage 权限（打 label、关闭重复 issue）；PR review 权限
- **怎么成为**：维护者主动邀请，或自荐说明你的贡献记录

### 维护者（Maintainer）

- **条件**：深度参与项目 3 个月以上，理解整体架构
- **权限**：合并 PR、发布版本、管理仓库设置
- **当前维护者**：[@Iterate-H](https://github.com/Iterate-H)

---

## Issue 管理 SOP

供维护者和协作者参考的工作流程：

### 日常分诊（每周 2-3 次，每次 15 分钟）

1. **查看新 Issue**：筛选 `needs-triage` label
2. **判断类型**：
   - 平台改版 → 加 `platform-change` + `bug`，优先处理
   - 普通 Bug → 加 `bug`，要求补充版本和截图
   - 功能建议 → 加 `enhancement`，评估价值
   - 信息不足 → 加 `needs-info`，评论要求补充
   - 重复问题 → 加 `duplicate`，链接到原 Issue，关闭
3. **移除 `needs-triage`**
4. **简单的适配问题**：标记 `good first issue`，写清修复思路，引导新贡献者

### 过期 Issue 处理

- 30 天无活动 + 等待信息中 → 评论提醒
- 60 天无活动 → 关闭，说明"如果问题仍存在请重新打开"
- 不自动关闭带 `platform-change` 和 `help wanted` 标签的 Issue

---

## AI 辅助贡献

用 Claude、Copilot 或其他 AI 工具写的代码？完全欢迎，标注一下就行：

- 在 PR 描述中注明使用了哪个 AI 工具
- 说明测试程度（没测 / 简单测了 / 完整测过）
- 确认你理解代码做了什么（不要提交自己看不懂的代码）

AI 辅助的 PR 和纯手写的 PR 一视同仁，我们只需要透明度。

---

有问题？直接开 [Issue](https://github.com/Iterate-H/zhipin-favorites/issues) 讨论。
