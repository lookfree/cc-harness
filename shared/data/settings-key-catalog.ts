/**
 * 已知 settings 键目录（MISC-14/15、PERM-06/10/11、MODEL-04/05 的配置面落点）：
 * key → 引入版本 + i18n 描述键（settings 命名空间 catalog.*）。
 * Settings 页的 effective 表用它给"认识的键"加说明与版本徽标；
 * 层级限制（写哪层不生效）由 settings-writer 的 KEY_LEVEL_RESTRICTIONS 单独负责。
 */
export interface SettingsKeyMeta {
  /** Claude Code 引入/关键演进版本 */
  since?: string
  /** i18n 描述键（settings:catalog.<descKey>） */
  descKey: string
  /** 仅 managed settings（企业管控）层生效的键 */
  managedOnly?: boolean
}

export const SETTINGS_KEY_CATALOG: Record<string, SettingsKeyMeta> = {
  autoMode: { since: '2.1.193', descKey: 'autoMode' },
  'autoMode.classifyAllShell': { since: '2.1.193', descKey: 'classifyAllShell' },
  disableAutoMode: { since: '2.1.207', descKey: 'disableAutoMode' },
  pluginConfigs: { since: '2.1.207', descKey: 'pluginConfigs' },
  'sandbox.credentials': { since: '2.1.187', descKey: 'sandboxCredentials' },
  axScreenReader: { since: '2.1.208', descKey: 'axScreenReader' },
  vimInsertModeRemaps: { since: '2.1.208', descKey: 'vimInsertModeRemaps' },
  respondToBashCommands: { since: '2.1.186', descKey: 'respondToBashCommands' },
  modelOverrides: { since: '2.1.73', descKey: 'modelOverrides' },
  fallbackModel: { since: '2.1.166', descKey: 'fallbackModel' },
  defaultMode: { since: '2.1.200', descKey: 'defaultMode' },
  requiredMinVersion: { since: '2.1.163', descKey: 'requiredVersion', managedOnly: true },
  requiredMaxVersion: { since: '2.1.163', descKey: 'requiredVersion', managedOnly: true },
  enforceAvailableModels: { since: '2.1.175', descKey: 'enforceAvailableModels' },
  availableModels: { since: '2.1.174', descKey: 'availableModels' },
}

export function settingsKeyMeta(key: string): SettingsKeyMeta | undefined {
  return SETTINGS_KEY_CATALOG[key] ?? SETTINGS_KEY_CATALOG[key.split('.')[0]]
}
