/**
 * 三层来源页（Skills/Commands/Agents）共用的来源助手。
 * 与 src/components/SourceBadge.tsx（染色组件）配套——这里是它的数据侧伴侣。
 */
interface SourceItem {
  name: string
  source?: string
  location?: string
  pluginName?: string
  version?: string
}

/** 来源（带兼容回退）：source 优先，回退旧 location，再回退 'user'。 */
export function sourceOf(x: SourceItem): string {
  return x.source ?? x.location ?? 'user'
}

/** 列表 key / 选中比较用的稳定标识（同名条目可来自多来源）。 */
export function sourceKey(x: SourceItem): string {
  return `${sourceOf(x)}:${x.pluginName ?? ''}:${x.version ?? ''}:${x.name}`
}

/** 来源 Badge 文案：plugin 带 pluginName@version，其余取 `filter.<source>`（三页 i18n 都用 filter.* 约定）。 */
export function sourceLabel(x: SourceItem, t: (k: string) => string): string {
  const src = sourceOf(x)
  return src === 'plugin' ? `${t('filter.plugin')} · ${x.pluginName}@${x.version}` : t(`filter.${src}`)
}
