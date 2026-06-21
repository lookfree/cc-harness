# spec010 · 模型治理面板

- 对应功能 ID：MODEL-01 / MODEL-02 / MODEL-03 / MODEL-04 / MODEL-05 / PERM-05 / PERM-06
- 所属 Phase：P1
- 前置依赖：spec009（统一 settings 写入层 `SettingsWriter`）
- 工作量估计：M

## 实际实现（与下文规划的偏差，2026-06）

按用户要求改为 **CC Switch 粒度的"每 provider 角色映射"**，而非下文规划的 settings.json 顶层治理字段：

- 现有 `Models.tsx` 那几家 provider（Claude/Kimi/智谱GLM/DeepSeek/OpenAI）每家从单个 `model` 字符串升级为 **角色→模型映射**（opus/sonnet/haiku/fable → 各家具体模型 id）+ `supports1m` + `apiFormat`（anthropic/openai）。预设填各家最新模型（Opus 4.8/Sonnet 4.6/Haiku 4.5/Fable 5、Kimi K2.6、GLM-5.2、DeepSeek V4、GPT-5.5）。
- `provider-manager.syncToClaudeSettings`：激活某 provider 时除 `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` 外，一并写 `ANTHROPIC_MODEL` 与 `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` env（未配置的角色清掉，避免残留上一家映射）。这是 CC Switch 的真实机制。
- `shared/types/provider.ts`：加 `ProviderModelMap`/`ProviderApiFormat`，`Provider.models/supports1m/apiFormat`，`ClaudeConfig.env` 补 5 个模型 env key。
- `Models.tsx`：表单加 4 角色映射输入 + apiFormat Select + supports1m Switch；卡片显示角色映射 + 1M/OpenAI Badge。Models.tsx 改用 `@shared/types` 的 `Provider`（删掉本地影子接口）。
- 下文规划的 settings.json 顶层治理字段（`modelOverrides`/`fallbackModel`/`availableModels`/版本约束，MODEL-04/05、PERM-05/06）**本次未做**，留待需要时再按下文规划补（已验证可基于 spec009 `getSettingsModel`/`setSettingKey` 实现）。
- 注：OpenAI（`apiFormat:'openai'`）的 baseUrl 是 OpenAI 格式，Claude Code 需网关代理转 Anthropic 才能用，UI 标 OpenAI Badge 提示。provider-manager 仍自管 read-modify-write（保留未知字段），是 spec009-4b 登记的跟进项。

---

## 目标

在 Models/Settings 页加一块**模型治理视图**，把 Claude Code 2.1.x 落在 settings.json 里的模型相关治理字段一网打尽并可视化读写：

- **MODEL-04** `modelOverrides`——分场景覆盖模型（2.1.73）。
- **MODEL-05** `fallbackModel`——主模型过载/不可用时按序回退，**最多 3 个**（2.1.166）。
- **PERM-05** `availableModels` / `enforceAvailableModels`——组织约束团队能用哪些模型（availableModels ≤2.1.174 / enforce 2.1.175，2.1.176 修贯穿 subagent/dispatch）。
- **PERM-06** `requiredMinVersion` / `requiredMaxVersion`——企业版本约束（managed setting，2.1.163）。
- **MODEL-01** Fast mode 默认模型（已升 Opus 4.7，2.1.142）——展示当前 Fast mode 模型说明。
- **MODEL-02 / MODEL-03** `/model` 的 this-session vs default 语义、废弃/自动切换模型警告（Fable 5 善后，2.1.183）——只读说明 + 对 `model` 字段是否指向已知废弃模型给提示。

**与 `provider-manager.ts` 的边界（关键，别重复造）**：`provider-manager.ts` 管的是**"用哪个 provider 端点 + 鉴权"**（`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`，写在 settings.json 的 `env.*`，见 `:218`-`:267`）。本 spec 管的是**"模型选择与组织治理"**（`model` / `modelOverrides` / `availableModels` 等顶层 key），与 provider 正交。两者都落 settings.json 但 key 不重叠，本 spec **不碰 `env.*`**，provider 切换逻辑原样不动。

settings.json 模型治理字段真实形态（按官方 managed settings / changelog）：

```json
{
  "model": "claude-opus-4-...",
  "fallbackModel": ["claude-sonnet-4-5", "claude-haiku-4-5"],
  "availableModels": ["claude-opus-4-...", "claude-sonnet-4-5"],
  "enforceAvailableModels": true,
  "modelOverrides": {
    "subagent": "claude-sonnet-4-5",
    "background": "claude-haiku-4-5"
  },
  "requiredMinVersion": "2.1.160",
  "requiredMaxVersion": "2.2.0"
}
```

## 现状（引用真实 file:line）

- `src/pages/Models.tsx:11`-`:25` 自定义 `Provider` 接口、`:27`-`:80` `defaultProviders` 列表——整页只做 **provider（端点+鉴权）管理**，把 `model` 当成 provider 的一个字符串字段（`:18` `model?: string`），**没有任何治理概念**：无 availableModels、无 fallbackModel、无 modelOverrides、无版本约束。
- `electron/services/provider-manager.ts:218` `syncToClaudeSettings` 只写/删 `env.ANTHROPIC_*`，**从不读写 settings.json 顶层 `model` / `availableModels` 等**。
- `electron/services/file-manager.ts` 无任何模型治理字段的读取。
- 本机 `~/.claude/settings.json` 实测无 `model`/`availableModels`/`fallbackModel`/`modelOverrides` 任何一个——所以本 spec 的写入全是**新增 key**，必须靠 spec009 的 `SettingsWriter` 保证不破坏 `enabledPlugins`/`tui` 等既有 key。

## 改动方案

### 1. 数据结构（新增 `shared/types/model-governance.ts`，`index.ts` 导出）

```ts
/** modelOverrides 的已知场景 key（也允许任意自定义 key） */
export type ModelOverrideScene = 'subagent' | 'background' | 'plan' | string

export interface ModelGovernance {
  /** settings.json 顶层 model（默认/会话模型） */
  model?: string
  /** 按序回退模型，最多 3 个（2.1.166） */
  fallbackModel?: string[]
  /** 组织允许的模型白名单（2.1.174） */
  availableModels?: string[]
  /** 是否强制只能用 availableModels（2.1.175，贯穿 subagent/dispatch 2.1.176） */
  enforceAvailableModels?: boolean
  /** 分场景覆盖模型（2.1.73） */
  modelOverrides?: Record<ModelOverrideScene, string>
  /** 企业版本约束（managed，2.1.163） */
  requiredMinVersion?: string
  requiredMaxVersion?: string
  /** 每个字段的来源层（来自 spec009 effective），UI 染色用 */
  sources?: Partial<Record<keyof ModelGovernance, 'user' | 'project' | 'local'>>
}

/** 已知废弃模型清单（驱动 MODEL-03 警告，本地维护，随 changelog 更新） */
export const DEPRECATED_MODELS: string[] = [
  // 例：下线后会话自动切换的旧模型（Fable 5 善后，2.1.183）
  // 落地时按官方公告填，留空也不影响功能
]

/** Fast mode 当前默认模型展示常量（MODEL-01，纯说明） */
export const FAST_MODE_DEFAULT_MODEL = 'claude-opus-4-7' // 2.1.142 升 4.7；2.1.154 后已有 Opus 4.8，Fast mode 可能已上调，以官方为准
```

### 2. 后端 FileManager（`electron/services/file-manager.ts`）

复用 spec009 的 `getSettingsModel()` 抽取治理字段，**不另起一套读取**：

```ts
async getModelGovernance(): Promise<ModelGovernance> {
  const model = await this.getSettingsModel()           // spec009
  const pick = (k: string) => model.effective.find(e => e.key === k)
  const g: ModelGovernance = {}
  const sources: ModelGovernance['sources'] = {}
  for (const key of ['model','fallbackModel','availableModels',
                      'enforceAvailableModels','modelOverrides',
                      'requiredMinVersion','requiredMaxVersion'] as const) {
    const e = pick(key)
    if (e) { (g as any)[key] = e.value; sources[key] = e.source }
  }
  g.sources = sources
  return g
}

/** 写单个治理字段到指定层，走 spec009 SettingsWriter（不碰 env.*） */
async setModelGovernanceKey(
  level: 'user'|'project'|'local',
  key: keyof ModelGovernance, value: unknown
): Promise<void> {
  // 校验：fallbackModel 最多 3 个；enforceAvailableModels 为 boolean 等
  if (key === 'fallbackModel' && Array.isArray(value) && value.length > 3)
    throw new Error('fallbackModel 最多 3 个')
  await this.setSettingKey(level, key, value)           // spec009
}
```

### 3. IPC（新增 `electron/ipc/models.ts` 或并入现有 providers handler 文件）

```ts
ipcMain.handle('models:getGovernance', () => fileManager.getModelGovernance())
ipcMain.handle('models:setGovernanceKey',
  (_e, level, key, value) => fileManager.setModelGovernanceKey(level, key, value))
```

`src/lib/api.ts` + preload 暴露 `models.getGovernance` / `models.setGovernanceKey`（与现有 `providers` 命名空间并列，互不影响）。

### 4. 前端（`src/pages/Models.tsx` 加 Tab，或 Settings 页子面板）

Models 页顶部加两个 Tab：**Providers（现状原样保留）** / **模型治理（新增）**。治理 Tab 内容：

**A. 默认模型 + Fast mode（MODEL-01/02/03）**
- `model` 字段编辑（Input + 来源层 Badge）；若 `model` ∈ `DEPRECATED_MODELS`，显示橙色"该模型已废弃，会话会自动切换（2.1.183）"。
- Fast mode 只读卡：显示 `FAST_MODE_DEFAULT_MODEL` + 说明"Fast mode 默认模型（2.1.142 升 Opus 4.7）"。
- this-session vs default 只读说明（MODEL-02）：解释 `/model` 的会话级 vs 默认保存语义，工具改的是 default（settings.json）。

**B. fallbackModel 编辑器（MODEL-05）**
- 有序列表，最多 3 行；每行 Input + 上下移 + 删除；满 3 个时"添加"禁用并提示"最多 3 个回退模型"。
- 保存调 `setGovernanceKey(level,'fallbackModel',[...])`。

**C. modelOverrides 编辑器（MODEL-04）**
- key-value 行：场景 key（下拉预设 `subagent`/`background`/`plan` + 自由输入）+ 模型 Input。增删行。
- 保存为 `Record<scene,model>`。

**D. 组织治理（PERM-05/06）——可折叠"Managed Settings"区**
- `availableModels`：tag 列表编辑（增删模型 id）。
- `enforceAvailableModels`：Switch。开启且 `availableModels` 非空时，对不在白名单内的 `model`/`fallbackModel`/`modelOverrides` 值标红提示"不在 availableModels 内，enforce 下会被拒"。
- `requiredMinVersion` / `requiredMaxVersion`：两个 Input + 说明"企业版本约束（2.1.163）"。
- 每个字段右侧来源层 Badge（user/project/local），写入时可选目标层。

## 实现步骤

- [ ] 1. `shared/types/model-governance.ts`：`ModelGovernance` / `ModelOverrideScene` / `DEPRECATED_MODELS` / `FAST_MODE_DEFAULT_MODEL`，`index.ts` 导出。
- [ ] 2. `file-manager.ts`：`getModelGovernance()`（基于 spec009 `getSettingsModel`）、`setModelGovernanceKey()`（含 fallbackModel ≤3 等校验，走 `setSettingKey`）。
- [ ] 3. `electron/ipc/models.ts`：2 个 handler；`index.ts` 注册；`api.ts` + preload `models` 命名空间。
- [ ] 4. `src/pages/Models.tsx`：加 Providers / 模型治理 Tab；治理 Tab 内 A/B/C/D 四块。
- [ ] 5. 复用 spec009 的来源层 Badge 组件（user 绿 / project 蓝 / local 橙）。
- [ ] 6. i18n：所有治理字段标签 + 废弃/enforce/版本约束文案。

## 验收标准

- [ ] 模型治理 Tab 能读出 settings.json 现有 `model`/`availableModels`/... 并显示来源层；本机（这些 key 不存在）时显示空状态、不报错。
- [ ] 编辑 `model` 写入后，`~/.claude/settings.json` 多出 `model` key 且 `enabledPlugins`/`tui` 等既有 key 完好（依赖 spec009 不丢字段）。
- [ ] `fallbackModel` 编辑器满 3 个时禁止再加；尝试通过 IPC 直传 4 个 → 后端 `setModelGovernanceKey` 抛"最多 3 个"。
- [ ] `modelOverrides` 加 `subagent→claude-sonnet-4-5` 保存后写出 `{"modelOverrides":{"subagent":"claude-sonnet-4-5"}}`，再读回还原表单。
- [ ] `enforceAvailableModels=true` 且 `availableModels=[A]`，把 `model` 设为 B（不在白名单）→ UI 对 B 标红提示。
- [ ] `requiredMinVersion`/`requiredMaxVersion` 能写入读回。
- [ ] 切换 provider（`provider-manager` 的 `switchProvider`）不影响治理字段，反之改治理字段不动 `env.ANTHROPIC_*`（两条写入路径互不覆盖——同一文件不同 key，靠 spec009 read-modify-write 保证）。
- [ ] `model` 设为 `DEPRECATED_MODELS` 中的值时显示废弃警告。

## 风险与备注

- **provider 与治理的写入竞态**：provider-manager（`:265` `.tmp`+rename）与 spec009 `SettingsWriter`（也 `.tmp`+rename）都原子写同一 `~/.claude/settings.json`，但都是"读全量→改局部 key→写全量"。**只要两者不同时并发**就互不丢字段；UI 上避免同一瞬间触发两边保存即可。长期建议 provider-manager 也迁到 `SettingsWriter`（统一一把锁），列为跟进，非本 spec 必须。
- 官方字段精确命名（`fallbackModel` 是数组还是 `fallbackModels`、`modelOverrides` 的场景 key 名）以官方 managed settings 文档为准；落地时对一遍，差异只改 `getModelGovernance` 的 key 列表与类型，UI 不动。
- `availableModels` / `enforceAvailableModels` / `requiredMin/MaxVersion` 在真实部署里常由**企业 managed settings**（可能是只读下发的更高优先级层）注入。工具允许本地编辑展示，但 UI 应提示"组织可能在更高层强制覆盖你的本地值"。managed settings 层的读取（若存在独立 managed 文件）超出本 spec，留 spec 备注，先按三层 settings 处理。
- Fast mode 默认模型是 Claude Code 内部常量、不在 settings.json，`FAST_MODE_DEFAULT_MODEL` 是本工具的展示常量，随官方版本手动更新，不可写入。
- `DEPRECATED_MODELS` 留空也不影响主功能，仅废弃警告失效；它是随 changelog 维护的本地清单，不联网拉取（演进路径"不接其他 harness/不联网"原则）。
