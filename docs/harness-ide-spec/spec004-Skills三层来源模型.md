# spec004 · Skills 三层来源模型

- 对应功能 ID：SKILL-01 / SKILL-02 / SKILL-03 / SKILL-04
- 所属 Phase：P1
- 前置依赖：spec003（扫描路径配置化 + 递归 glob 工具）
- 工作量估计：M

## 目标

把 Skills 的扫描从"写死单一 marketplace 目录"重写成 **user / project / plugin 三层来源模型**，覆盖 Claude Code 2.1.x 真实磁盘结构（plugin cache 多 marketplace、多 plugin、多版本，且区分 user/project 安装 scope）。前端 Skills 页加 source 列染色、加同名覆盖提醒、加 source 过滤。

核心事实（本机已核实，`~/.claude/plugins/`）：

- 三层目录：
  - user：`~/.claude/skills/<name>/SKILL.md`
  - project：`<cwd>/.claude/skills/<name>/SKILL.md`
  - plugin：`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md`
- `~/.claude/plugins/installed_plugins.json` 是"哪个版本被装在哪个 scope"的真相源（结构见下），同一 plugin 可同时有 `scope:"user"` 和 `scope:"project"` 多条，各带 `installPath` / `version`。
- `~/.claude/settings.json` 的 `enabledPlugins`（形如 `{"superpowers@claude-plugins-official": true}`）是"plugin 是否启用"的真相源。
- 覆盖规则：同名 skill，**user 覆盖 project 覆盖 plugin**（实际 Claude Code 中 user/project 显式定义优先于 plugin 提供）。被覆盖者仍要扫出来并标 `overriddenBy`，不能丢。

## 现状（引用真实 file:line）

- `electron/services/file-manager.ts:187` `getSkills()`：
  - `:192` 硬编码 `path.join(this.userConfigPath, 'plugins', 'marketplaces', 'anthropic-agent-skills')`——这个目录在 2.1.x 已不存在（现在是 `plugins/cache/<mp>/<plugin>/<ver>/skills/`），所以本机已装的 superpowers / last30days 一个都扫不到。
  - `:195` 单层 `fs.readdir`，非递归。
  - `:204` `:228` `:246` 三处 `parseSkillMD(..., 'user')` / `location:'project'`，`location` 只有两值。
- `electron/services/file-manager.ts:253` `parseSkillMD(filePath, location: 'user' | 'project')`——签名只接受两层 location，返回的 `Skill` 不带 source/marketplace/version。
- `shared/types/skill.ts:47` `location?: 'user' | 'project'`——**无 `source`、无 `marketplace`、无 `pluginName`、无 `version`、无 `overriddenBy`**。
- `electron/ipc/skills.ts:6` `skills:getAll` 直接透传 `getSkills()`。
- `src/pages/Skills.tsx:60` 列表过滤只按 name/description；`:265` 列表项只渲染 `skill.location` 一个 Badge；无 source 染色、无覆盖提醒、无 source 过滤。

## 改动方案

### 1. 类型 diff（`shared/types/skill.ts`）

```diff
 export interface Skill {
   name: string
   type: 'skill'
   description: string
   enabled?: boolean
   triggers?: SkillTrigger
   implementation: SkillImplementation
   metadata?: SkillMetadata
   references?: SkillReference[]
   scripts?: SkillScript[]
   dependencies?: string[]
   filePath?: string
-  location?: 'user' | 'project'
+  /** @deprecated 保留兼容旧代码，新代码用 source。映射：source==='plugin' 时 location 取 'user' */
+  location?: 'user' | 'project'
+  /** 来源层。plugin = 来自 ~/.claude/plugins/cache 下某 marketplace 的某 plugin */
+  source?: 'user' | 'project' | 'plugin'
+  /** 仅 source==='plugin' 有效：所属 marketplace，如 'claude-plugins-official' */
+  marketplace?: string
+  /** 仅 source==='plugin' 有效：plugin 名，如 'superpowers' */
+  pluginName?: string
+  /** 仅 source==='plugin' 有效：版本号，如 '6.0.3' */
+  version?: string
+  /** plugin 安装 scope（来自 installed_plugins.json），用于区分同一 plugin 的 user/project 安装 */
+  pluginScope?: 'user' | 'project'
+  /** 若本条被同名更高优先级来源覆盖，记录覆盖者的稳定 id（见 skillUid） */
+  overriddenBy?: string
   content?: string
 }
+
+/** skill 稳定唯一标识：source==='plugin' 时含 marketplace/plugin/version，否则 source:name */
+export type SkillUid = string
```

新增工具类型（同文件，供前后端共用）：

```ts
export interface InstalledPluginEntry {
  scope: 'user' | 'project'
  projectPath?: string
  installPath: string
  version: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
}
export type InstalledPlugins = Record<string /* `${plugin}@${marketplace}` */, InstalledPluginEntry[]>
```

### 2. 后端 FileManager（`electron/services/file-manager.ts`）

新增私有方法 + 重写 `getSkills()`：

- `private async readInstalledPlugins(): Promise<InstalledPlugins>`——读 `~/.claude/plugins/installed_plugins.json` 的 `.plugins`，ENOENT 静默返回 `{}`。
- `private async readEnabledPlugins(): Promise<Record<string, boolean>>`——读 `~/.claude/settings.json` 的 `enabledPlugins`，ENOENT 返回 `{}`。
- `private computeSkillUid(s: Skill): SkillUid`——`s.source==='plugin' ? `plugin:${s.marketplace}/${s.pluginName}@${s.version}/${s.name}` : `${s.source}:${s.name}``。
- 改 `parseSkillMD(filePath, location)` → 改造为接受一个 `source` 与可选 plugin 元信息的 opts 对象（见伪代码），并把 source/marketplace/pluginName/version/pluginScope 写进返回的 Skill。保留 `location` 字段以兼容（plugin/user→'user'，project→'project'）。

`getSkills()` 伪代码：

```ts
async getSkills(): Promise<Skill[]> {
  const out: Skill[] = []
  const installed = await this.readInstalledPlugins()
  const enabled = await this.readEnabledPlugins()

  // ---- 1. user 层 ----
  await this.scanSkillDir(
    path.join(this.userConfigPath, 'skills'),
    { source: 'user' }, out)

  // ---- 2. project 层 ----
  await this.scanSkillDir(
    path.join(this.projectPath, '.claude', 'skills'),
    { source: 'project' }, out)

  // ---- 3. plugin 层 ----
  // 用 installed_plugins.json 的 installPath 精确定位，而不是盲扫 cache，
  // 这样能拿到 version/scope，也只扫真正"装了"的版本（cache 里可能残留旧版本目录）。
  for (const [key, entries] of Object.entries(installed)) {
    const [pluginName, marketplace] = key.split('@')  // 'superpowers@claude-plugins-official'
    if (enabled[key] === false) continue              // 显式禁用的 plugin 跳过（可选：扫但标 disabled）
    for (const entry of entries) {
      const skillsRoot = path.join(entry.installPath, 'skills')
      await this.scanSkillDir(skillsRoot, {
        source: 'plugin', marketplace, pluginName,
        version: entry.version, pluginScope: entry.scope,
      }, out)
    }
  }

  // ---- 4. 覆盖检测：同 name，优先级 user > project > plugin ----
  // ⚠️ 关键：同一个 plugin 可能有多条 entry（不同 scope/version 同名 skill 集），
  // 它们 source 都是 'plugin'，光按 source 分级会平级 → reduce 取第一个、另一条不标 overriddenBy
  // → 同名 skill 重复显示两次且都不灰显（把废弃版本当激活）。必须对 plugin 加 tie-break。
  // 本机实证：superpowers 注册了 5.0.7(project) + 6.0.3(user) 两条 entry，skills/ 下同名。
  const semverKey = (v?: string) =>
    (v ?? '0').split('.').map(n => String(parseInt(n, 10) || 0).padStart(6, '0')).join('.')
  // 返回可比较元组：[来源层级, plugin内scope层级, 版本] —— 逐项降序取胜
  const rankTuple = (s: Skill): [number, number, string] => [
    s.source === 'user' ? 3 : s.source === 'project' ? 2 : 1,
    s.pluginScope === 'user' ? 1 : 0,        // 同为 plugin 时 user-scope 胜 project-scope
    semverKey(s.version),                    // 再按版本号高者胜（与 spec005 pickCurrent 同口径）
  ]
  const gt = (a: Skill, b: Skill) => {       // a 是否优于 b
    const ta = rankTuple(a), tb = rankTuple(b)
    for (let i = 0; i < 3; i++) if (ta[i] !== tb[i]) return ta[i] > tb[i]
    return false
  }
  const byName = new Map<string, Skill[]>()
  for (const s of out) (byName.get(s.name) ?? byName.set(s.name, []).get(s.name)!).push(s)
  for (const group of byName.values()) {
    if (group.length < 2) continue
    const winner = group.reduce((a, b) => gt(b, a) ? b : a)
    const winnerUid = this.computeSkillUid(winner)
    for (const s of group) if (s !== winner) s.overriddenBy = winnerUid   // 其余全部标覆盖，含同 plugin 旧版本
  }
  return out
}

// scanSkillDir：单层 readdir <dir>/*/SKILL.md（与现状一致，skill 一层目录），
// 对每个 SKILL.md 调 parseSkillMD(opts)。dir 不存在静默返回。
// （若 spec003 提供递归 glob，可改用 glob '*/SKILL.md'，但 skill 标准就是单层目录。）
```

> 关于"扫被禁用 plugin"：默认 `enabled[key] === false` 跳过。若产品要展示"已装但禁用"的 skill（灰显），改为不跳过、给 Skill 加 `enabled:false` 并在 UI 灰显——本 spec 取"跳过"，禁用展示留到 spec005 Plugins 页统一做。

### 3. IPC（`electron/ipc/skills.ts`）

`skills:getAll` 无需改签名（仍返回 `Skill[]`，新字段随对象带出）。前端读 `skill.source` 即可。无新增 handler。

### 4. 前端（`src/pages/Skills.tsx`）

- 顶部新增 source 过滤（shadcn `Select`，参考 Commands.tsx 已用的 Select 组件）：`全部 / user / project / plugin`。`filteredSkills`（`:60`）追加 `&& (sourceFilter==='all' || skill.source===sourceFilter)`。
- 列表项（`:252`-`:268`）：把现有单个 `location` Badge 换成 **source Badge 染色**：
  - `user` → 绿色（`variant="default"` 或自定义 `bg-emerald`）
  - `project` → 蓝色
  - `plugin` → 紫色，文案显示 `plugin · {pluginName}@{version}`
  - 若 `skill.overriddenBy` 存在：整行加 `opacity-60 line-through` + 一个橙色 "被覆盖" Badge，hover tooltip 显示覆盖者 uid。
- 详情面板（`:358` 附近）：plugin 来源时加一栏显示 `marketplace / pluginName / version / pluginScope`；被覆盖时加醒目提示条"此 skill 被 {overriddenBy} 覆盖，实际不会加载"。
- 提取 `<SourceBadge source overriddenBy>` 小组件，spec006 Commands 复用。

## 实际落地（在 spec003 现有代码上做增量 —— spec004 文档写在 spec003 实现之前，"现状"已过时）

spec003 已把 getSkills 重写过（plugin via installed_plugins + user via globScan + project JSON，扁平字段也加了）。本 spec 在其上增量，几处与原文设计的差异：
- **`readInstalledPlugins` 保留 spec003 的扁平数组形态**（`{pluginName,marketplace,scope,version,installPath}[]`），不改成原文的 `InstalledPlugins` Record——扁平形态在 getSkills 里更顺手，`InstalledPlugins`/原文版 `InstalledPluginEntry` 不引入。
- **`parseSkillMD` 签名不动**（仍 `(filePath, location)`）：source/plugin 元信息由 `scanSkillDir` 在 parse 后用 opts 装饰（`{...skill, ...opts}`），比改 parseSkillMD 签名更小、更清晰。
- **project 层**：新增 `scanSkillDir(project/.claude/skills)` 扫 SKILL.md（真实 Claude Code 格式），同时**保留** spec003 的 project JSON 扫描（历史兼容，非标准格式，不删避免丢行为）。
- **SourceBadge** 做成 Skills.tsx 内联组件（染色 + plugin 显示 `plugin · pluginName@version`），spec006 可复用。
- **source 过滤**用 Button group（项目未引 Select 组件，避免新依赖）。
- **getSkill 返回 winner**（`!overriddenBy` 优先）——收口 code-review #3 的按 name 不确定性；plugin 只读护栏（spec003 加的）保留为正式策略。
- **i18n**：新建 `skills` namespace（en+zh），过滤标签/覆盖文案走 `t()`；现有硬编码字符串不在本 spec 范围，不动。

## 实现步骤

- [x] 1. `shared/types/skill.ts`：source/marketplace/pluginName/version/pluginScope/overriddenBy（spec003 已加）+ 本 spec 加 `SkillUid`、`SkillSource`、`InstalledPluginEntry`（扁平版）。
- [x] 2. `file-manager.ts`：加 `readInstalledPlugins()`（spec003）、`readEnabledPlugins()`、`computeSkillUid()`、`scanSkillDir()`、`markSkillOverrides()`。
- [x] 3. `scanSkillDir` 在 parse 后装饰 source/plugin 元信息（不改 parseSkillMD 签名）；location 兼容映射（plugin/user→'user'，project→'project'）。
- [x] 4. 重写 `getSkills()`：三层 SKILL.md（scanSkillDir）+ project JSON 兼容 + enabledPlugins 过滤 + `markSkillOverrides` 去重；getSkill 返回 winner。
- [x] 5. `Skills.tsx` 内联 `SourceBadge` 组件（染色）。
- [x] 6. `Skills.tsx`：source 过滤 Button group、列表项染色 + 覆盖灰显（opacity+line-through+amber badge）、选中改按 filePath 比较（修 code-review #5）、详情面板 SourceBadge + 覆盖提示条。
- [x] 7. i18n：新建 `skills` namespace（en+zh），注册到 `i18n/index.ts`。

## 验收标准

> 验证：tsx 驱动真实 `~/.claude` + app 实跑。

- [x] Skills 页能看到 plugin skill（superpowers/last30days）+ user skill，getSkills 返回 31、app 无崩溃、preload 正常。
- [x] plugin skill 染色紫色显示 `plugin · pluginName@version`；user 绿 / project 蓝（SourceBadge）。
- [x] **同 plugin 多 scope/版本去重**：本机 superpowers（5.0.7 project + 6.0.3 user）→ `brainstorming` 实测 2 条，winner=6.0.3/user（不带 overriddenBy），5.0.7/project 标 `overriddenBy` 并灰显（list-through + opacity + amber badge）。winner 判定 user-scope>project-scope 再版本高者。
- [x] `getSkill('brainstorming')` 确定性返回 winner（6.0.3，`!overriddenBy`）——收口 code-review #3。
- [x] `computeSkillUid(winner)` = `plugin:claude-plugins-official/superpowers@6.0.3/brainstorming`，唯一稳定。
- [x] 删除 `installed_plugins.json`（临时空目录）后 `getSkills()` 不抛错（ENOENT 静默），仅返回 user/project skill。
- [x] source 过滤 Button group（全部/用户/项目/插件，中英双语），选项过滤 `filteredSkills`。
- [x] 列表项保留原结构（name + badge 行），仅叠加染色/覆盖标记；所有来源 item 都在（含被覆盖的灰显条）。
- [ ] 单测（未写自动化单测，已用 tsx 手测覆盖上述场景；正式单测框架待 Phase 2 引入）。

## 风险与备注

- cache 目录可能残留"装过又升级"的旧版本目录（本机 superpowers 有 5.0.7/5.1.0/6.0.0/6.0.2/6.0.3 共 5 个）。**必须以 `installed_plugins.json` 的 installPath 为准**扫描，否则会把废弃版本也当成激活 skill 列出。
- `enabledPlugins` 的 key 是 `plugin@marketplace`，与 `installed_plugins.json` 的 key 同构，可直接拼接匹配。
- skill 目录是单层（`skills/<name>/SKILL.md`），不依赖 spec003 的递归 glob；但 plugin 根的发现依赖 installed_plugins.json，不依赖盲扫，这点与 spec003 的"扫描路径配置化"解耦。若后续要支持自定义 plugin cache 路径，再接 spec003 的配置项。
- `parseSkillMD` 现有 mtime 缓存（`:256`-`:262`）按 filePath 缓存，三层模型下 filePath 仍唯一，缓存可保留；但缓存的 Skill 对象不含 source（同一文件路径 source 固定），安全。
- 覆盖优先级"user>project>plugin"是本工具的展示约定，若后续核实 Claude Code 真实加载顺序不同（如 project>user），改 `rank()` 一处即可。
- **已加临时只读护栏（spec003 落地后、code-review 发现，需本 spec 收口）**：spec003 让 plugin skill 进入了 `getSkills`，但 `getSkill/saveSkill/deleteSkill` 仍按 **name** 解析、且 plugin skill 的 `filePath` 指向插件真实 SKILL.md、`location` 被错标 `'user'`——`deleteSkill('某插件skill名')` 会 `fs.unlink` 掉插件安装目录里的真实文件，**破坏已装插件**。已在 `file-manager.ts` 的 `saveSkill`/`deleteSkill` 加 `if (skill.source === 'plugin') throw` 护栏先堵住破坏性删除。**本 spec 实现时要系统收口**：把 getSkill/save/delete 从「按 name」改成「按 `computeSkillUid` / `filePath`」解析，配合本 spec 的同名去重（`rankTuple`），从根上消除 name 冲突导致的误删/误写；届时这个临时 `throw` 护栏可保留为"插件只读"的正式策略（plugin skill 本就不该由本工具改），但解析必须改对。
```