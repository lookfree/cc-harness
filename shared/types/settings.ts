export type SettingsLevel = 'user' | 'project' | 'local'

/** 一层 settings 文件快照 */
export interface SettingsLayer {
  level: SettingsLevel
  filePath: string
  exists: boolean
  /** 原始解析对象（保留全部未知字段，写回时不丢） */
  raw: Record<string, unknown>
  /** 解析/读取错误（JSON 非法等），exists 但 parse 失败时填 */
  parseError?: string
}

export interface EffectiveSetting {
  /** 点号路径，如 'model' / 'permissions.allow' / 'worktree.baseRef' */
  key: string
  value: unknown
  /** 该有效值来自哪一层 */
  source: SettingsLevel
  /** 同一 key 在更低优先级层也定义了（被本层覆盖），按优先级降序记录 */
  overriddenLevels?: SettingsLevel[]
  /**
   * 该 key 在这些层虽有定义，但 Claude Code（≥2.1.207）不再读取该层的此键——写了也不生效。
   * 例：autoMode 不读 settings.local.json；pluginConfigs 只认 user 层。
   */
  ignoredLevels?: SettingsLevel[]
  /** source 本身就是被忽略的层（所有定义都落在不生效的层里）时为 true，UI 应显著提示 */
  sourceIgnored?: boolean
}

/** 合并三层后的视图 */
export interface SettingsModel {
  layers: SettingsLayer[] // 顺序固定 [user, project, local]
  effective: EffectiveSetting[]
}

/** safe-mode / 内置 skill 等开关的只读展示模型 */
export interface SafetyToggles {
  /** settings.json 顶层 disableBundledSkills（2.1.169），落盘可读可写 */
  disableBundledSkills?: boolean
  /** 该值来自哪一层（用于 UI 展示） */
  disableBundledSkillsSource?: SettingsLevel
  /** --safe-mode 是 CLI 启动 flag，不落盘；工具只展示说明 */
  safeModeAvailable: true
}
