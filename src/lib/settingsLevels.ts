import type { SettingsLevel } from '@shared/types'

/** 三层 settings：user / project / local（local 优先级最高）。Settings/Permissions 等页共用。 */
export const SETTINGS_LEVELS: SettingsLevel[] = ['user', 'project', 'local']

/** 层来源染色：user 绿 / project 蓝 / local 橙（三层概念全仓统一一处，避免各页颜色漂移）。 */
export const LEVEL_BADGE_CLASS: Record<SettingsLevel, string> = {
  user: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  project: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  local: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
}
