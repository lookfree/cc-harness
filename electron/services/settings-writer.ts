import { promises as fs } from 'fs'
import path from 'path'
import { isMissing } from './glob-scan'
import type { SettingsLevel, SettingsLayer, SettingsModel, EffectiveSetting } from '../../shared/types'

const LEVEL_ORDER: Record<SettingsLevel, number> = { user: 1, project: 2, local: 3 }
const LEVELS: SettingsLevel[] = ['user', 'project', 'local']

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 按点号路径读一个值（'a.b.c'）；缺失中间对象/叶子返回 undefined。 */
export function getByPath(obj: Record<string, unknown>, keyPath: string): unknown {
  let cur: unknown = obj
  for (const seg of keyPath.split('.')) {
    if (!isPlainObject(cur)) return undefined
    cur = cur[seg]
  }
  return cur
}

/** 按点号路径写一个值，沿途缺失的对象自动补 {}；返回新对象（不可变，不改入参）。 */
export function setByPath(obj: Record<string, unknown>, keyPath: string, value: unknown): Record<string, unknown> {
  const segs = keyPath.split('.')
  const root: Record<string, unknown> = { ...obj }
  let cur = root
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]
    const child = cur[seg]
    cur[seg] = isPlainObject(child) ? { ...child } : {}
    cur = cur[seg] as Record<string, unknown>
  }
  cur[segs[segs.length - 1]] = value
  return root
}

/** 按点号路径删一个 key（unset）；返回新对象（不可变）。缺失路径原样返回。 */
export function unsetByPath(obj: Record<string, unknown>, keyPath: string): Record<string, unknown> {
  const segs = keyPath.split('.')
  const root: Record<string, unknown> = { ...obj }
  let cur = root
  for (let i = 0; i < segs.length - 1; i++) {
    const child = cur[segs[i]]
    if (!isPlainObject(child)) return root // 中间路径不存在，无可删
    cur[segs[i]] = { ...child }
    cur = cur[segs[i]] as Record<string, unknown>
  }
  delete cur[segs[segs.length - 1]]
  return root
}

/**
 * settings.json 统一写入层：read-modify-write 整个对象、原子写（.tmp + rename）、保留未知字段。
 * 所有改 settings 的路径都走它，不再各写各的（spec009）。
 */
export class SettingsWriter {
  constructor(private resolvePath: (level: SettingsLevel) => string) {}

  /** 读任意路径的 settings 文件。ENOENT → exists:false、raw:{}；JSON 非法 → exists:true + parseError。 */
  async readAtPath(filePath: string, level: SettingsLevel): Promise<SettingsLayer> {
    let raw: Record<string, unknown> = {}
    let exists = false
    let parseError: string | undefined
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      exists = true
      try {
        const parsed = JSON.parse(content)
        if (isPlainObject(parsed)) raw = parsed
      } catch (e) {
        parseError = (e as Error).message
      }
    } catch (e) {
      if (!isMissing(e)) throw e // 非缺失（权限等）不静默
    }
    return { level, filePath, exists, raw, parseError }
  }

  readLayer(level: SettingsLevel): Promise<SettingsLayer> {
    return this.readAtPath(this.resolvePath(level), level)
  }

  /** 读出整对象用于写前 modify。ENOENT → {}；JSON 非法抛错（不静默覆盖坏文件）；非对象顶层 → {}。 */
  private async loadRaw(filePath: string): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      return isPlainObject(parsed) ? parsed : {}
    } catch (e) {
      if (isMissing(e)) return {}
      throw e // JSON 非法不静默吞
    }
  }

  /** 往任意路径写一个 key：整对象 read-modify-write，原子落盘，保留其余字段。value===undefined 等价 unset。 */
  async writeKeyAtPath(filePath: string, keyPath: string, value: unknown): Promise<void> {
    const raw = await this.loadRaw(filePath)
    const next = value === undefined ? unsetByPath(raw, keyPath) : setByPath(raw, keyPath, value)
    await this.atomicWrite(filePath, next)
  }

  writeKey(level: SettingsLevel, keyPath: string, value: unknown): Promise<void> {
    return this.writeKeyAtPath(this.resolvePath(level), keyPath, value)
  }

  /** 批量写多个 key（一次 read-modify-write，避免多次落盘竞态）。 */
  async writeKeys(level: SettingsLevel, entries: Array<{ keyPath: string; value: unknown }>): Promise<void> {
    const filePath = this.resolvePath(level)
    let next = await this.loadRaw(filePath)
    for (const { keyPath, value } of entries) {
      next = value === undefined ? unsetByPath(next, keyPath) : setByPath(next, keyPath, value)
    }
    await this.atomicWrite(filePath, next)
  }

  private async atomicWrite(filePath: string, data: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, filePath)
  }

  /** 读三层、计算 effective 合并视图（local > project > user）。 */
  async getModel(): Promise<SettingsModel> {
    const layers = await Promise.all(LEVELS.map((l) => this.readLayer(l)))

    // 收集每层的「顶层 key（整对象）+ 一层嵌套叶子」点号路径
    const pathMaps = layers.map((layer) => {
      const paths = new Map<string, unknown>()
      for (const [k, v] of Object.entries(layer.raw)) {
        paths.set(k, v) // 父 key 整对象条目（下游可取整对象）
        if (isPlainObject(v)) {
          for (const [k2, v2] of Object.entries(v)) paths.set(`${k}.${k2}`, v2) // 叶子条目
        }
      }
      return { level: layer.level, paths }
    })

    const allKeys = new Set<string>()
    pathMaps.forEach((pm) => pm.paths.forEach((_v, k) => allKeys.add(k)))

    const effective: EffectiveSetting[] = []
    for (const key of allKeys) {
      const having = pathMaps.filter((pm) => pm.paths.has(key))
      const winner = having.reduce((a, b) => (LEVEL_ORDER[b.level] > LEVEL_ORDER[a.level] ? b : a))
      const overridden = having
        .filter((pm) => pm !== winner)
        .map((pm) => pm.level)
        .sort((a, b) => LEVEL_ORDER[b] - LEVEL_ORDER[a]) // 优先级降序
      effective.push({
        key,
        value: winner.paths.get(key),
        source: winner.level,
        overriddenLevels: overridden.length ? overridden : undefined,
      })
    }
    return { layers, effective }
  }
}
