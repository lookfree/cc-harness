import type { HookType } from '@shared/types'

// Hook event types grouped by domain for the Select dropdown.
export const HOOK_TYPE_GROUPS: Array<{ group: string; types: HookType[] }> = [
  { group: 'tool', types: ['PreToolUse', 'PostToolUse', 'MessageDisplay'] },
  {
    group: 'session',
    types: ['SessionStart', 'SessionEnd', 'PostSession', 'UserPromptSubmit', 'Notification'],
  },
  { group: 'lifecycle', types: ['Stop', 'StopFailure', 'SubagentStart', 'SubagentStop'] },
  { group: 'compaction', types: ['PreCompact', 'PostCompact'] },
  { group: 'audit', types: ['ConfigChange'] },
  {
    group: 'interaction',
    types: ['Elicitation', 'ElicitationResult', 'PermissionRequest'],
  },
]

export const HOOK_TYPES: HookType[] = HOOK_TYPE_GROUPS.flatMap((g) => g.types)
