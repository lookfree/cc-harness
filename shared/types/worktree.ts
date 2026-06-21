import type { SettingsLevel } from './settings'

/** 后台会话隔离模式（2.1.143）；以官方枚举为准 */
export type WorktreeBgIsolation = 'none' | 'worktree'

export interface WorktreeConfig {
  /** worktree 基准 ref，如 'main' / 'origin/main'（2.1.133） */
  baseRef?: string
  /** 后台会话隔离模式（2.1.143） */
  bgIsolation?: WorktreeBgIsolation
  /** 每个字段来源层（来自 spec009 effective），UI 染色 */
  sources?: Partial<Record<'baseRef' | 'bgIsolation', SettingsLevel>>
}

/** bgIsolation 下拉选项。label/hint 走 i18n `worktree.isolation.<value>` / `<value>Hint`（与全仓 `t(`prefix.${value}`)` 约定一致）。 */
export const BG_ISOLATION_OPTIONS: WorktreeBgIsolation[] = ['none', 'worktree']
