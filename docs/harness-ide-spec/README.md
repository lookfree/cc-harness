# harness-ide-spec · 实现 spec 索引

这个目录放 claude-code-debugger 从「配置浏览器」演进到「Harness 工作台」的**可执行实现 spec**。每个 spec 是一份能直接照着写代码的施工图——引用真实 `file:line`、给确切 diff / 类型定义、列可测验收标准。

配套两份上层文档：

- [claude-code-debugger 演进路径](../claude-code-debugger演进路径.md)——产品思路与 Phase 0/1/2/3 划分。
- [功能版本对照表](./功能版本对照表.md)——功能 ID 索引（ORCH / OBS / HOOK / PERM / MODEL / SKILL / MISC）。spec 通过「对应功能 ID」字段挂回这张表。

---

## 编号规则

- **spec001–spec021** 首批覆盖 Phase 0–2，按 Phase 顺序连续编号，不复用删除的号：
  - **Phase 0 · 止血**：spec001–spec003
  - **Phase 1 · 补配置层**：spec004–spec013
  - **Phase 2 · 运行时观测与调试**：spec014–spec021
- **spec022 起为追加 spec，编号顺延、phase 归属以 spec 头部「所属 Phase」字段为准**（不强求文件号与 phase 连续）。spec022（依赖与 Electron 版本核验）归 Phase 0，补审查发现的 Phase 0 覆盖缺口（MISC-11）。
- Phase 3（编排与教学）是 Phase 0–2 扎实后的产品溢出，暂不编 spec，待 Phase 2 收口后再排。
- 新增 spec 一律顺延编号，文件名格式 `specNNN-<短标题>.md`（NNN 三位补零）。

## 与功能版本对照表 ID 的对应关系

- 每个 spec 头部「对应功能 ID」字段填对照表里的稳定 ID（如 `SKILL-01`、`HOOK-01..11`），或填「项目自身 bug」（Phase 0 的 build / 降级类无功能 ID）。
- 一个 spec 可对多个 ID（如 spec004 = SKILL-01/02/03/04），一个 ID 也可跨 spec（如 SKILL-01 的地基在 spec003、完整三层模型在 spec004）。
- 对照表的「Issue」列建 GitHub issue 后回填，spec 与 issue 一一对应或多对一。

## spec 模板约定

每个 spec 严格按以下结构（中文）：

```
# specNNN · <标题>

- 对应功能 ID：<列出，或"项目自身 bug">
- 所属 Phase：<P0/P1/P2>
- 前置依赖：<specNNN，或"无">
- 工作量估计：<S(<1天)/M(1-3天)/L(>3天)>

## 目标        —— 一句话说清做什么 + 为什么值得做
## 现状        —— 当前代码怎么做的，必须引用真实 file:line
## 改动方案     —— 数据结构/类型、后端 FileManager/IPC、前端页面/组件，分小节
## 实现步骤     —— 每步落到具体文件，可勾选
## 验收标准     —— 可测试、可观察的结果，复选框
## 风险与备注
```

约定：

- 「现状」必须引真实 `file:line`，禁止泛泛而谈。
- 「改动方案」给确切 diff 或类型定义，不写「大概改一下」。
- 「验收标准」每条可测、可观察（能写成命令或 DevTools 断言）。
- 工作量估计：S < 1 天 / M 1–3 天 / L > 3 天。
- **凡引入 UI 的 spec，实现步骤必须含 i18n 一项**（en + zh 双语 namespace，文案走 `t()` 不硬编码）；纯后端/无 UI 的 spec（如 spec001/002/003/014/022）不需要。

## 状态流转

| 状态 | 含义 |
|---|---|
| 草稿 | spec 正文还在写或待评审，方案未定 |
| 就绪 | 方案定稿、验收标准明确，可以开工 |
| 进行中 | 已有人/分支在实现 |
| 完成 | 代码合并 + 验收标准全过 |

状态写在下方清单表「状态」列，随实现进度手动维护。spec001–spec021 正文均已落盘、方案定稿，状态为「就绪」，可按 Phase 顺序开工。

---

## 全量 spec 清单（spec001–spec022）

### Phase 0 · 止血（spec001–003、spec022）

| 编号 | 标题 | Phase | 对应 ID | 状态 |
|---|---|---|---|---|
| spec001 | build 时序与 preload 修复 | P0 | 项目自身 bug | ✅ 完成 |
| spec002 | 扫描报错降级 | P0 | 项目自身 bug | ✅ 完成 |
| spec003 | 扫描路径配置化地基 | P0 | SKILL-01（地基） | ✅ 完成 |
| spec022 | 依赖与 Electron 版本核验 | P0 | MISC-11 | ✅ 完成 |

### Phase 1 · 补配置层（spec004–013）

| 编号 | 标题 | Phase | 对应 ID | 状态 |
|---|---|---|---|---|
| spec004 | Skills 三层来源模型 | P1 | SKILL-01/02/03/04 | ✅ 完成 |
| spec005 | Plugin Marketplace 浏览器 | P1 | SKILL-05/06 | ✅ 完成 |
| spec006 | Commands 三层来源 | P1 | SKILL（Commands 部分） | ✅ 完成 |
| spec007 | Hooks 类型系统补全 | P1 | HOOK-01..11 | ✅ 完成 |
| spec008 | 权限编辑器 | P1 | PERM-01/03/04 | ✅ 完成 |
| spec009 | 配置写入与 settings 分层 | P1 | PERM-02/07 | ✅ 完成 |
| spec010 | 模型治理面板 | P1 | MODEL-01..05、PERM-05/06 | ✅ 完成（按 CC Switch 粒度，见 spec 内"实际实现"） |
| spec011 | Worktree 配置面板 | P1 | MISC-03 | ✅ 完成 |
| spec012 | Agents 页真正实现 | P1 | ORCH-07 | ✅ 完成 |
| spec013 | MCP 配置升级 | P1 | MISC-04/05/06 | ✅ 完成 |

### Phase 2 · 运行时观测与调试（spec014–021）

| 编号 | 标题 | Phase | 对应 ID | 状态 |
|---|---|---|---|---|
| spec014 | session-jsonl 解析层 | P2 | OBS-01 | ✅ 完成 |
| spec015 | Session 监视器 | P2 | ORCH-01/02/04/05、OBS-06 | ✅ 完成 |
| spec016 | Subagent 调用树与 Workflow 编排视图 | P2 | ORCH-06/09 | ✅ 完成 |
| spec017 | Token-Usage 面板 | P2 | OBS-02/03/05 | 就绪 |
| spec018 | Hook 沙箱执行器 | P2 | HOOK 可执行化 | 就绪 |
| spec019 | loop 定时任务面板 | P2 | ORCH-08 | 就绪 |
| spec020 | MCP 健康面板 | P2 | MISC-06 | 就绪 |
| spec021 | 记忆面板与 dream 可视化 | P2 | ORCH-10、MISC-07/08 | 就绪 |

### 暂不做（对照表标了 Phase 但有意不排 spec）

审查发现这几个 ID 在对照表里映射到了 P1/P2，但有意**不排 spec**——理由是与五支柱关联弱、或无外部工具可介入的落盘契约。在功能版本对照表对应行标「暂不做」，避免"标了 Phase 却静默缺 spec"。

| ID | 能力 | 原 Phase | 暂不做理由 |
|---|---|---|---|
| MISC-10 | LSP 集成 | P1 | LSP 配置面极小（基本自动），与"配置/观测"支柱关联弱；真有需求再补 |
| MISC-12 | Windows PowerShell / ARM64 | P1 | 是 Claude Code 自身的平台适配，不是本工具要配置的对象；工具自身跨平台由 Electron 保证（spec001 已注意 Windows `mkdir`） |
| MISC-13 | Rewind / Summarize from here | P2 | 纯 TUI 内交互，无配置面、无稳定落盘产物，外部工具无从介入 |
| OBS-04 | Monitor 工具 | P2 | Claude 会话内的工具能力，无独立落盘契约；其 tool_use 已被 spec015 session 监视器看到，无需单独面板 |
| OBS-05 | OTEL span agent_id | P2 | OTEL 走外部 collector（Jaeger/Prometheus），工具自带 collector 过重；token/调用统计已由 spec017 从 jsonl 自算，不依赖 OTEL（spec017 已留对接口子） |
| MISC-08 | Context Editing + Memory Tool（API 能力） | P2 | 是 Anthropic API 侧能力、非 Claude Code 配置；spec021 已明确不覆盖其 API 侧 |

如后续需要，任一项可顺延编号补 spec（如 spec023+），并把对照表状态改回 TODO。

---

## 依赖关系速览

- **Phase 0** 内部：spec001 独立；spec002 独立；spec003 建议在 spec002 之后（缺失降级统一后抽 glob 函数更干净），三者均可并行起步。
- **Phase 1 地基**：spec003 是 spec004（三层来源）、spec005（Marketplace）、spec006（Commands 三层）的扫描层前置。
- **Phase 2 地基**：spec014（jsonl 解析层）是 spec015/016/017 的共同前置；按演进路径第五节，它应「单独写、单独测」。

## 维护约定

- 改 spec 正文 → 同步更新本表「状态」列。
- 新增 spec → 顺延编号、追加到对应 Phase 表、回填功能版本对照表的 Issue 列。
- 功能版本对照表新增 ID 后，若需新 spec 承接，在此排号。
