export const defaultNS = 'common'
export const fallbackLng = 'en'
export const supportedLngs = ['en', 'zh'] as const

export type SupportedLanguage = typeof supportedLngs[number]

export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  zh: '中文',
}
