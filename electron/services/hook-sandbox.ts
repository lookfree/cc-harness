import { spawn } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import type { Hook, HookAction, HookSimInput, HookDryRunResult, HookActionType } from '../../shared/types'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 1024 * 1024 // 1 MB

/** 构造 Claude Code 传给 hook 的 stdin JSON */
function buildInputJson(hook: Hook, input: HookSimInput): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    session_id: input.sessionId ?? 'dryrun-session',
    transcript_path: '/dev/null',
    hook_event_name: hook.type,
    cwd: input.cwd ?? os.homedir(),
  }
  if (input.toolName !== undefined) obj.tool_name = input.toolName
  if (input.toolInput !== undefined) obj.tool_input = input.toolInput
  if (input.toolOutput !== undefined) obj.tool_response = input.toolOutput
  if (input.prompt !== undefined) obj.prompt = input.prompt
  if (input.message !== undefined) obj.message = input.message
  if (input.extra) Object.assign(obj, input.extra)
  return obj
}

/** 解析 hook stdout/exitCode → 语义决策 */
function parseDecision(
  stdout: string,
  exitCode: number | null
): Pick<HookDryRunResult, 'decision' | 'blockReason' | 'transformedOutput'> {
  const trimmed = stdout.trim()
  if (trimmed.startsWith('{')) {
    try {
      const p = JSON.parse(trimmed) as Record<string, unknown>
      const d = (p.decision ?? p.action) as string | undefined
      if (d === 'block') return { decision: 'block', blockReason: (p.reason ?? p.message) as string | undefined }
      if (p.updatedInput !== undefined || p.additionalContext !== undefined) {
        return { decision: 'transform', transformedOutput: p.updatedInput ?? p.additionalContext }
      }
      if (d === 'allow') return { decision: 'allow' }
    } catch { /* not JSON */ }
  }
  // exit 2 = block per Claude Code hook convention
  if (exitCode === 2) return { decision: 'block', blockReason: trimmed || undefined }
  if (exitCode !== null && exitCode !== 0) return { decision: 'block', blockReason: `exit ${exitCode}` }
  if (exitCode === 0) return { decision: 'allow' }
  return { decision: 'none' }
}

function resolveActionType(action: HookAction): HookActionType {
  if (action.type === 'http' || action.type === 'prompt') return action.type
  return 'command'
}

async function runCommand(
  action: HookAction,
  inputJson: Record<string, unknown>,
  timeoutMs: number,
  maxBytes: number,
  startMs: number,
  base: Omit<HookDryRunResult, 'decision' | 'blockReason' | 'transformedOutput' | 'durationMs' | 'timedOut'>
): Promise<HookDryRunResult> {
  const tmpDir = path.join(os.tmpdir(), `cc-hook-dryrun-${process.pid}-${Date.now()}`)
  try { fs.mkdirSync(tmpDir, { recursive: true }) } catch { /* already exists */ }

  // 白名单 env：只透传 PATH/HOME/TMPDIR，不透传 token/key
  const safeEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: os.homedir(),
    TMPDIR: os.tmpdir(),
    TERM: 'dumb',
    HOOK_EVENT_NAME: base.hookType,
  }

  return new Promise<HookDryRunResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let totalBytes = 0

    const proc = action.args
      ? spawn(action.command ?? '', action.args, { shell: false, cwd: tmpDir, env: safeEnv })
      : spawn(action.command ?? '', { shell: true, cwd: tmpDir, env: safeEnv })

    const timer = setTimeout(() => {
      timedOut = true
      try { proc.kill('SIGKILL') } catch { /* already gone */ }
    }, timeoutMs)

    // stdin: hook input JSON
    try { proc.stdin?.write(JSON.stringify(inputJson) + '\n'); proc.stdin?.end() } catch { /* pipe closed */ }

    const onData = (chunk: Buffer, target: 'out' | 'err') => {
      totalBytes += chunk.length
      if (totalBytes > maxBytes) { try { proc.kill('SIGKILL') } catch { /* */ }; return }
      if (target === 'out') stdout += chunk.toString()
      else stderr += chunk.toString()
    }
    proc.stdout?.on('data', (c: Buffer) => onData(c, 'out'))
    proc.stderr?.on('data', (c: Buffer) => onData(c, 'err'))

    proc.on('close', (exitCode) => {
      clearTimeout(timer)
      const { decision, blockReason, transformedOutput } = parseDecision(stdout, exitCode)
      resolve({ ...base, exitCode, stdout, stderr, decision, blockReason, transformedOutput, durationMs: Date.now() - startMs, timedOut })
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ...base, exitCode: null, stdout, stderr, decision: 'none', error: err.message, durationMs: Date.now() - startMs, timedOut })
    })
  })
}

async function runHttp(
  action: HookAction,
  inputJson: Record<string, unknown>,
  timeoutMs: number,
  startMs: number,
  base: Omit<HookDryRunResult, 'decision' | 'blockReason' | 'transformedOutput' | 'durationMs' | 'timedOut'>
): Promise<HookDryRunResult> {
  const url = action.url ?? ''
  const method = action.method ?? 'POST'
  const headers = { 'Content-Type': 'application/json', ...(action.headers ?? {}) }
  let body = action.body ?? JSON.stringify(inputJson)
  body = body.replace(/\$\{([^}]+)\}/g, (_, k) => {
    const v = (inputJson as Record<string, unknown>)[k]
    return v !== undefined ? String(v) : ''
  })
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { method, headers, body: method !== 'GET' ? body : undefined, signal: ctrl.signal })
    clearTimeout(timer)
    const responseBody = await res.text()
    const { decision, blockReason, transformedOutput } = parseDecision(responseBody, res.ok ? 0 : 1)
    return { ...base, exitCode: res.status, stdout: responseBody, stderr: '', decision, blockReason, transformedOutput, durationMs: Date.now() - startMs, timedOut: false, httpStatus: res.status, httpResponseBody: responseBody }
  } catch (err) {
    const e = err as Error
    return { ...base, exitCode: null, stdout: '', stderr: '', decision: 'none', error: e.message, durationMs: Date.now() - startMs, timedOut: e.name === 'AbortError' }
  }
}

/**
 * 沙箱 dry-run 一个 hook action。
 * 安全边界：spawn + 临时 cwd + env 白名单 + 超时硬杀 + 输出上限 + 网络默认关。
 * ⚠ 仍是真实执行，hook 本身的副作用（写文件等）不可被拦截，UI 必须显著警示。
 */
export async function dryRunHook(hook: Hook, action: HookAction, input: HookSimInput): Promise<HookDryRunResult> {
  const actionType = resolveActionType(action)
  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const startMs = Date.now()

  const base = {
    hookName: hook.name,
    hookType: hook.type,
    actionType,
    exitCode: null as number | null,
    stdout: '',
    stderr: '',
  }

  if (actionType === 'prompt') {
    // prompt hook 交给 LLM 执行，dry-run 只展示模板
    return { ...base, decision: 'none', durationMs: 0, timedOut: false, stdout: action.prompt ?? '' }
  }

  const inputJson = buildInputJson(hook, input)

  if (actionType === 'http') {
    if (!input.allowNetwork) {
      return { ...base, decision: 'none', error: 'network_disabled', durationMs: Date.now() - startMs, timedOut: false }
    }
    return runHttp(action, inputJson, timeoutMs, startMs, base)
  }

  return runCommand(action, inputJson, timeoutMs, MAX_OUTPUT_BYTES, startMs, base)
}
