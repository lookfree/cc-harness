import type { Hook, HookType } from '@shared/types'
import type { HookActionItem } from './HookActionForm'

export type EditFormState = {
  name: string
  type: HookType
  description: string
  enabled: boolean
  location: 'user' | 'project'
  projectPath: string
  priority: number
  stopOnError: boolean
  pattern: string
  // Claude Code native format fields
  matcher: string
  matcherIndex?: number // Index of the hook in settings.json for editing
  actions: HookActionItem[]
  // Type-specific matcher-level fields
  reloadSkills: boolean // SessionStart
  sessionTitle: string // SessionStart
  maxBlocks: number // Stop / StopFailure
  replaceToolOutput: boolean // PostToolUse
  effort?: Hook['effort'] // read-only display
}
