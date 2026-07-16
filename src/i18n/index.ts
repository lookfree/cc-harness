import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { defaultNS, fallbackLng, supportedLngs } from './config'

// Import translation files
import commonEn from './locales/en/common.json'
import layoutEn from './locales/en/layout.json'
import dashboardEn from './locales/en/dashboard.json'
import modelsEn from './locales/en/models.json'
import commandsEn from './locales/en/commands.json'
import hooksEn from './locales/en/hooks.json'
import skillsEn from './locales/en/skills.json'
import pluginsEn from './locales/en/plugins.json'
import permissionsEn from './locales/en/permissions.json'
import settingsEn from './locales/en/settings.json'
import agentsEn from './locales/en/agents.json'
import mcpEn from './locales/en/mcp.json'
import sessionsEn from './locales/en/sessions.json'
import memoryEn from './locales/en/memory.json'
import loopsEn from './locales/en/loops.json'
import bgagentsEn from './locales/en/bgagents.json'

import commonZh from './locales/zh/common.json'
import layoutZh from './locales/zh/layout.json'
import dashboardZh from './locales/zh/dashboard.json'
import modelsZh from './locales/zh/models.json'
import commandsZh from './locales/zh/commands.json'
import hooksZh from './locales/zh/hooks.json'
import skillsZh from './locales/zh/skills.json'
import pluginsZh from './locales/zh/plugins.json'
import permissionsZh from './locales/zh/permissions.json'
import settingsZh from './locales/zh/settings.json'
import agentsZh from './locales/zh/agents.json'
import mcpZh from './locales/zh/mcp.json'
import sessionsZh from './locales/zh/sessions.json'
import memoryZh from './locales/zh/memory.json'
import loopsZh from './locales/zh/loops.json'
import bgagentsZh from './locales/zh/bgagents.json'

export const resources = {
  en: {
    common: commonEn,
    layout: layoutEn,
    dashboard: dashboardEn,
    models: modelsEn,
    commands: commandsEn,
    hooks: hooksEn,
    skills: skillsEn,
    plugins: pluginsEn,
    permissions: permissionsEn,
    settings: settingsEn,
    agents: agentsEn,
    mcp: mcpEn,
    sessions: sessionsEn,
    memory: memoryEn,
    loops: loopsEn,
    bgagents: bgagentsEn,
  },
  zh: {
    common: commonZh,
    layout: layoutZh,
    dashboard: dashboardZh,
    models: modelsZh,
    commands: commandsZh,
    hooks: hooksZh,
    skills: skillsZh,
    plugins: pluginsZh,
    permissions: permissionsZh,
    settings: settingsZh,
    agents: agentsZh,
    mcp: mcpZh,
    sessions: sessionsZh,
    memory: memoryZh,
    loops: loopsZh,
    bgagents: bgagentsZh,
  },
} as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    fallbackLng,
    supportedLngs,

    interpolation: {
      escapeValue: false, // React already escapes
    },

    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },

    react: {
      useSuspense: false,
    },
  })

export default i18n
