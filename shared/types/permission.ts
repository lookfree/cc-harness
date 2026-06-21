export type PermissionLevel = 'user' | 'project' | 'local'
export type PermissionEffect = 'allow' | 'deny' | 'ask'

/** 单个参数约束：param:value 形式（无命名 key 的工具 key 为空串） */
export interface PermissionParam {
  key: string // 'domain' / 'command'；路径/命令整体匹配时为 ''
  value: string // 'github.com' / 'npm run *'
  isGlob: boolean // 是否含 * / **
}

/** 解析后的单条权限规则 */
export interface PermissionRule {
  raw: string // 原始字符串，如 'WebFetch(domain:github.com)' 或 'Bash'
  tool: string // 'WebFetch' / 'Bash' / 'Read' ...
  params: PermissionParam[] // 无括号时为空数组（= 整工具放行/禁止）
  effect: PermissionEffect // 来自所属 allow/deny/ask
  level: PermissionLevel // 来自所属文件层
  overriddenBy?: PermissionLevel // 被更高优先级层的同 effect 同 raw 覆盖时，记覆盖层
}

/** 一层文件的完整权限快照 */
export interface PermissionLayer {
  level: PermissionLevel
  filePath: string
  allow: PermissionRule[]
  deny: PermissionRule[]
  ask: PermissionRule[]
  exists: boolean
}

/** 合并三层后的视图（供 UI 展示覆盖关系） */
export interface PermissionModel {
  layers: PermissionLayer[] // [user, project, local]
  effective: PermissionRule[] // 实际生效（未被覆盖的 winner）
}
