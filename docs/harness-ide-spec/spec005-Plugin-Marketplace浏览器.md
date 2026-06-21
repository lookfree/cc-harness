# spec005 · Plugin / Marketplace 浏览器

- 对应功能 ID：SKILL-05 / SKILL-06
- 所属 Phase：P1
- 前置依赖：spec004（`InstalledPlugins` 类型、`readInstalledPlugins/readEnabledPlugins`）
- 工作量估计：M

## 目标

新增 **Plugins 页**，把 Claude Code 的 plugin 生态可视化：marketplace → plugin → 各已装版本 → 当前 enable 哪个版本 → 组件清单（skills/commands/agents/hooks 计数）。提供 enable/disable/init 操作，优先调 `claude plugin` CLI，CLI 不可用时降级为"只读 + 直接改 settings.json `enabledPlugins`"。

数据真相源（本机已核实）：

- `~/.claude/plugins/known_marketplaces.json`：marketplace 列表，每个带 `source.repo`（github 等）、`installLocation`、`lastUpdated`。
- `~/.claude/plugins/installed_plugins.json`：`{plugins: {"<plugin>@<marketplace>": [{scope, projectPath?, installPath, version, installedAt, lastUpdated, gitCommitSha}]}}`。
- `~/.claude/settings.json` 的 `enabledPlugins`：`{"<plugin>@<marketplace>": true|false}`。
- 每个版本目录有 `<installPath>/.claude-plugin/plugin.json`：`{name, description, version, author, homepage, repository, license, keywords}`。
- 组件目录：`<installPath>/{skills/<n>/SKILL.md, commands/*.md, agents/*.md, hooks/*}`。

## 现状（引用真实 file:line）

- 项目无任何 Plugins 页、无 plugin 相关 IPC、无 plugin 类型。`electron/ipc/` 下只有 skills/hooks/mcp/commands/agents/claudemd/project/providers。
- `electron/services/file-manager.ts:192` 唯一一处碰 plugins 目录的代码，且写死、已失效（详见 spec004 现状）。
- `src/App.tsx` / `src/components/layout/Layout.tsx` 的侧边栏导航需新增 Plugins 入口（参考现有 Skills/Commands 页注册方式）。

## 改动方案

### 1. 新增类型（`shared/types/plugin.ts`，并在 `shared/types/index.ts` 导出）

```ts
export interface MarketplaceSource {
  source: 'github' | 'git' | 'local' | string
  repo?: string
  url?: string
}
export interface Marketplace {
  name: string                  // 'claude-plugins-official'
  source: MarketplaceSource
  installLocation: string
  lastUpdated?: string
}
export interface PluginVersion {
  version: string
  scope: 'user' | 'project'
  projectPath?: string
  installPath: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
  enabled: boolean              // 该 key 在 enabledPlugins 是否为 true
  isCurrent: boolean            // 是否当前生效版本（见下方"当前版本"判定）
  manifest?: PluginManifest     // 读自 .claude-plugin/plugin.json
  components?: PluginComponentCount
}
export interface PluginManifest {
  name: string
  description?: string
  version?: string
  author?: { name?: string; email?: string } | string
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
}
export interface PluginComponentCount {
  skills: number
  commands: number
  agents: number
  hooks: number
}
export interface Plugin {
  key: string                   // '<plugin>@<marketplace>'
  name: string                  // 'superpowers'
  marketplace: string           // 'claude-plugins-official'
  enabled: boolean              // enabledPlugins[key] === true
  versions: PluginVersion[]     // 已装的所有版本（多 scope/多版本）
  currentVersion?: string       // isCurrent 那条的 version
}
export interface PluginCliResult {
  ok: boolean
  cliAvailable: boolean         // claude CLI 是否在 PATH
  stdout?: string
  stderr?: string
  message: string
}
```

### 2. 后端 FileManager 新增方法（`electron/services/file-manager.ts`）

复用 spec004 的 `readInstalledPlugins()` / `readEnabledPlugins()`。

- `async getMarketplaces(): Promise<Marketplace[]>`——读 `known_marketplaces.json`，map 成数组。
- `async getPlugins(): Promise<Plugin[]>`：

```ts
async getPlugins(): Promise<Plugin[]> {
  const installed = await this.readInstalledPlugins()  // spec004
  const enabled = await this.readEnabledPlugins()
  const out: Plugin[] = []
  for (const [key, entries] of Object.entries(installed)) {
    const [name, marketplace] = key.split('@')
    const versions: PluginVersion[] = []
    for (const e of entries) {
      const manifest = await this.readJSONFile<PluginManifest>(
        path.join(e.installPath, '.claude-plugin', 'plugin.json'))
      versions.push({
        version: e.version, scope: e.scope, projectPath: e.projectPath,
        installPath: e.installPath, installedAt: e.installedAt,
        lastUpdated: e.lastUpdated, gitCommitSha: e.gitCommitSha,
        enabled: enabled[key] === true,
        isCurrent: false,                       // 下面统一标
        manifest: manifest ?? undefined,
        components: await this.countPluginComponents(e.installPath),
      })
    }
    // 当前版本判定：enabled 且 scope==='user' 的最高 version；
    // 没有 user scope 则取 enabled 的最高 version；都没有取最高 version。
    const current = pickCurrent(versions)       // semver 比较，见 utils
    if (current) current.isCurrent = true
    out.push({
      key, name, marketplace,
      enabled: enabled[key] === true,
      versions, currentVersion: current?.version,
    })
  }
  return out
}

// countPluginComponents：分别 readdir 统计 skills/*/SKILL.md、commands/*.md、
// agents/*.md、hooks 下文件数；目录不存在记 0。
```

- `private async countPluginComponents(installPath): Promise<PluginComponentCount>`。

### 3. 新增 IPC（`electron/ipc/plugins.ts`，在 `electron/ipc/index.ts` 注册）

```ts
ipcMain.handle('plugins:getMarketplaces', () => fileManager.getMarketplaces())
ipcMain.handle('plugins:getAll', () => fileManager.getPlugins())
ipcMain.handle('plugins:details', (_e, key: string) => runClaudePlugin(['details', key]))
ipcMain.handle('plugins:enable',  (_e, key: string) => setPluginEnabled(key, true))
ipcMain.handle('plugins:disable', (_e, key: string) => setPluginEnabled(key, false))
ipcMain.handle('plugins:init',    (_e, name: string, cwd?: string) => runClaudePlugin(['init', name], cwd))
```

CLI 封装（child_process）+ 降级：

```ts
// 探测 claude 是否在 PATH（which/where），缓存结果
async function isClaudeOnPath(): Promise<boolean> { ... }

async function runClaudePlugin(args: string[], cwd?: string): Promise<PluginCliResult> {
  if (!await isClaudeOnPath())
    return { ok: false, cliAvailable: false, message: 'claude CLI 不在 PATH，已降级为只读/直接改 settings.json' }
  // spawn('claude', ['plugin', ...args], { cwd }); 收集 stdout/stderr/exitCode
}

// enable/disable：优先 claude plugin enable/disable <key>；
// CLI 不可用时直接改 ~/.claude/settings.json 的 enabledPlugins[key] = bool（保留其他键）。
async function setPluginEnabled(key: string, val: boolean): Promise<PluginCliResult> {
  const cli = await runClaudePlugin([val ? 'enable' : 'disable', key])
  if (cli.cliAvailable) return cli
  await fileManager.setEnabledPlugin(key, val)   // 直接改 settings.json，新增此 FileManager 方法
  return { ok: true, cliAvailable: false, message: `已直接写入 settings.json: ${key}=${val}` }
}
```

新增 `FileManager.setEnabledPlugin(key, val)`：读 `~/.claude/settings.json` → 改 `enabledPlugins[key]` → 写回（保留缩进/其他字段），ENOENT 时新建。

> 本机实测 `claude` 不在 PATH，所以**降级路径是必经主路径，必须实现且默认走得通**，CLI 路径作为增强。

### 4. 前端 API（`src/lib/api.ts`）

```ts
plugins: {
  getMarketplaces: () => invoke('plugins:getMarketplaces'),
  getAll:    () => invoke('plugins:getAll'),
  details:   (key: string) => invoke('plugins:details', key),
  enable:    (key: string) => invoke('plugins:enable', key),
  disable:   (key: string) => invoke('plugins:disable', key),
  init:      (name: string, cwd?: string) => invoke('plugins:init', name, cwd),
}
```

并在 `electron/preload.cjs` / `electron/preload.ts` 暴露对应方法（参考现有 skills 暴露方式）。Web 模式（`server/index.ts`）只镜像 `getMarketplaces`/`getAll`/`details`（只读）；enable/disable/init 返回 501 或前端禁用按钮。

### 5. 新增页面（`src/pages/Plugins.tsx`）

布局：左 marketplace 分组的 plugin 列表，右 plugin 详情。

- marketplace 分组标题：name + `source.repo` + lastUpdated。
- plugin 卡片：name、enabled 开关（调 enable/disable，禁用时整组灰显）、`currentVersion` Badge、各 scope 版本小标。
- 版本子列表：每个 `PluginVersion` 一行——version、scope（user/project Badge）、isCurrent 高亮、组件计数（skills N / commands N / agents N / hooks N）、installedAt、gitCommitSha 短哈希。
- 详情区：plugin.json manifest（description/author/homepage/license/keywords）；底部 "查看 details" 按钮调 `plugins:details`（CLI 可用时展示 token 成本预估等原始输出，不可用时提示"需要 claude CLI"）。
- 顶部："Init 新插件" 按钮 → 输入名字 → 调 `plugins:init`。
- CLI 不可用时：页面顶部一条 info 横幅"claude CLI 未检测到，enable/disable 将直接写 settings.json，details/init 不可用"。

### 6. 导航注册

- `src/components/layout/Layout.tsx`：侧边栏加 Plugins 入口（icon 用 lucide `Puzzle` 或 `Package`）。
- `src/App.tsx`：加路由 `/plugins` → `<Plugins />`。

## 实际落地（与 spec 的偏离，已记录）

- **`readInstalledPlugins` 沿用 spec004 的扁平数组**（非原文 Record）——`getPlugins` 里按 `${pluginName}@${marketplace}` 分组适配，不改 spec004 的实现。
- **`setEnabledPlugin` 自包含 read-modify-write**（原子写 .tmp+rename、保留其他字段）——spec009 的统一 `SettingsWriter` 还没做，先按 saveHookToSettings 模式自写，spec009 落地后收口。
- **新增 `plugins:cliStatus` handler**（原文没有）——给页面初次加载就能判断 CLI 是否在 PATH、决定是否显示降级横幅，比"靠某次 enable/disable 结果反推"干净。
- **UI 暂未接 init/details 按钮**——本机 CLI 不在 PATH，这两个功能不可用，i18n 文案已备（initPlugin/details/detailsUnavailable），CLI 可用环境再接。enable/disable 走 settings.json 降级主路径，已实现且验证。
- `pickCurrent`/`semverKey` 内联在 file-manager（与 markSkillOverrides 同口径），未抽 utils。

## 实现步骤

- [x] 1. `shared/types/plugin.ts` 新建类型，`index.ts` 导出。
- [x] 2. `file-manager.ts`：`getMarketplaces()`、`getPlugins()`、`countPluginComponents()`、`setEnabledPlugin()`、`pickCurrent()`/`semverKey()`。
- [x] 3. `electron/ipc/plugins.ts`：cliStatus + 6 handler + `isClaudeOnPath`/`runClaudePlugin`/`setPluginEnabled` 降级；`index.ts` 注册。
- [x] 4. `preload.cjs` + `preload.ts`：暴露 plugins 方法 + Window 类型。
- [x] 5. `src/lib/api.ts`：`plugins` 命名空间（含 cliStatus，Web 只读降级）。
- [x] 6. `src/pages/Plugins.tsx`：marketplace 分组列表 + enable/disable + 版本/组件计数 + manifest 详情 + CLI 降级横幅（init/details 按钮待 CLI 环境）。
- [x] 7. `Layout.tsx`（Puzzle 图标 + nav.plugins）+ `App.tsx`（/plugins 路由）。
- [x] 8. `server/index.ts`：Web 只读镜像 `GET /api/plugins`、`/api/plugins/marketplaces`。
- [x] 9. i18n：新建 `plugins` namespace（en+zh）+ layout nav.plugins。

## 验收标准

> 验证：tsx 驱动真实 `~/.claude` + setEnabledPlugin 临时目录测 + app 实跑。

- [x] `getMarketplaces` 返回 3 个 marketplace（claude-plugins-official / superpowers-marketplace / last30days-skill），各带 source.repo。
- [x] superpowers `currentVersion=6.0.3`（user-scope 高版本胜，pickCurrent）；组件计数实测 skills:14 / hooks:6（commands:0 —— superpowers 6.0.3 实际无 commands 目录，spec 原假设"commands>0"有误，代码准确反映真实结构）。
- [x] last30days（3.3.2/user）、rust-analyzer-lsp（1.0.0/user）版本与 scope 正确。
- [x] `setEnabledPlugin('a@m', false)` → settings.json `enabledPlugins['a@m']=false`，再 true 变回；`theme` 等其他字段 + 其他 enabledPlugins 键全保留（临时目录验）。CLI 不在 PATH 时走 settings.json 降级。
- [x] `cliStatus` 探测 CLI 不在 PATH → 页面显示降级横幅；enable/disable 走 settings.json，不抛异常。
- [x] 删除 `installed_plugins.json`（readInstalledPlugins ENOENT→[]）页面不崩、plugin 列表空、marketplace 仍显示。
- [x] `pickCurrent` 实测：superpowers [user-6.0.3, project-5.0.7] 选 user-6.0.3（user-scope 优先）。app 启动干净（preload true、无编译错误）。

## 风险与备注

- `claude plugin enable/disable` 的确切子命令名以实际 CLI 为准；降级到 settings.json 是稳健兜底，无论 CLI 名是否变都能工作。
- `enabledPlugins` 是按 `plugin@marketplace` 粒度，**不分版本**——即 enable/disable 是 plugin 级而非版本级，UI 不要给单个 version 提供 enable 开关，只给 plugin 提供。
- `installed_plugins.json` 的 `version` 字段是 schema v2（`{version:2, plugins:{...}}`），读时取 `.plugins`。
- `details` 输出（token 成本预估等）是 CLI 富文本/JSON，先原样展示，结构化解析留作后续（OBS-03）。
- 与 spec004 共享 `readInstalledPlugins`/`readEnabledPlugins`，两 spec 合并实现时注意只写一份。
```