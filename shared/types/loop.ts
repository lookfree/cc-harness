export interface LoopTask {
  /** `${sessionId}:${toolUseId}` */
  id: string
  sessionId: string
  encodedCwd: string
  cwd: string
  /** ScheduleWakeup.input.reason — why the wakeup was scheduled */
  description: string
  /** ScheduleWakeup.input.prompt — what Claude will do when it wakes */
  prompt: string
  delaySeconds: number
  /** ISO timestamp when ScheduleWakeup tool_use was recorded */
  scheduledAt: string
  /** ISO timestamp = scheduledAt + delaySeconds */
  fireAt: string
  status: 'pending' | 'fired' | 'expired'
  /** ISO timestamp of the matching scheduled_task_fire event, if found */
  firedAt?: string
  source: 'jsonl'
}
