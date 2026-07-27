# spec027 · tool_result 的 ANSI 颜色渲染

- 对应功能 ID：OBS 增强（Replay 体验，对标 CCHV 的 ANSI 还原）
- 所属 Phase：P2
- 前置依赖：spec015（ConversationReplay）
- 工作量估计：S（<1天）

## 目标

Replay 里 Bash 等工具的终端输出目前是"带乱码的纯文本"（ANSI 转义序列原样进 `<pre>`），把它还原成带颜色/粗细的终端样式——测试红绿、diff 加减色、构建工具的彩色日志一眼可读。CCHV 已做此项，是我们 Replay 体验的明显缺口。

## 现状

- `src/components/sessions/ConversationReplay.tsx:153`：tool_result 卡片把 `e.contentText` 直接放进 `<pre>`，ESC 字符不可见、`[31m` 等参数串显示为乱码。
- `electron/services/session/session-parser.ts:45,134`：`contentText` 截断到 `maxResultChars ?? 4000`——**可能把转义序列拦腰截断**，渲染层必须容忍残缺尾部。
- 项目零 ANSI 相关依赖；无测试基建（无 vitest/jest）。

## 改动方案

### 1. 纯函数解析器（新增 `src/lib/ansi.ts`，零依赖）

```ts
export interface AnsiSegment {
  text: string
  fg?: string        // CSS color
  bg?: string
  bold?: boolean
  dim?: boolean      // 渲染为 opacity .6
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}
/** 快速探测：含任意 ESC 即走解析路径（只认 ESC[ 会漏纯 OSC 输出，冒烟实测发现） */
export function hasAnsi(s: string): boolean
/** SGR 状态机切段；非 SGR 序列剥离；尾部残缺转义丢弃 */
export function parseAnsi(s: string): AnsiSegment[]
```

- 支持的 SGR：0 重置、1/2/3/4/9 及对应关闭码、7 inverse（有 fg/bg 才交换，否则忽略）、30–37/90–97 前景、40–47/100–107 背景、39/49 恢复默认、`38;5;n`/`48;5;n` 256 色（16 基色查表 + 216 色立方公式 + 24 灰阶公式）、`38;2;r;g;b` 真彩色。分隔符 `;` 与 `:` 都认。
- 剥离不渲染：非 `m` 结尾的 CSI（光标移动等）、OSC（`ESC]...BEL/ST`，终端标题、超链接——链接只留文本）、其他两字节转义。
- 16 色调色板用中等对比度常量（红 #ef4444、绿 #22c55e 等 tailwind 中间值），深浅主题下都可读；black/white 两端避开纯黑纯白。
- 输出 React 渲染用的结构化段，**不产出 HTML 字符串**——无 `dangerouslySetInnerHTML`，无 XSS 面。

### 2. 渲染接入（`ConversationReplay.tsx`）

tool_result 卡片的 `<pre>` 内容改为：`hasAnsi(e.contentText)` 时渲染 `<AnsiText text={...}/>`（组件内 `useMemo(parseAnsi)`，段映射为带 inline style 的 `<span>`），否则维持现状纯字符串。非 ANSI 输出零开销、渲染路径不变。

## 实现步骤

- [x] 1. `src/lib/ansi.ts`：`hasAnsi` + `parseAnsi` + 调色板。
- [x] 2. `ConversationReplay.tsx`：`AnsiText` 小组件 + tool_result 接入。
- [x] 3. 解析器冒烟验证：tsx 脚本喂典型样例（红绿测试输出、256 色、真彩色、截断尾部、纯文本直通）核对分段结果。
- [x] 4. `npx tsc --noEmit` 通过。
- [x] 5. i18n：无新增用户文案（纯渲染改动），免动。

## 验收标准

- [x] 找一个含 Bash 彩色输出的 session（如跑过测试/构建的），Replay 展开 tool_result：颜色/粗体按终端语义显示，无 `[31m` 乱码残留。
- [x] 不含 ANSI 的 tool_result 渲染结果与改动前完全一致（纯字符串路径）。
- [x] 构造截断样例（`\x1b[3` 结尾）不抛错、残缺转义不显示。
- [x] `ESC]0;标题BEL` 等 OSC 序列被剥离不显示。
- [x] `npx tsc --noEmit` 0 错误。

## 风险与备注

- 不做终端模拟（光标寻址/清屏/回车覆写按原样丢弃控制码、文本保留）——进度条类输出（`\r` 刷新）会显示为多行累积，属已知取舍，真要还原得上 xterm.js 量级，不值。
- 调色板刻意不跟随 CSS 主题变量——终端 16 色是语义色（红=错、绿=过），用固定中对比值在两种主题下语义都成立，避免为此引入主题联动复杂度。
- 将来拓扑 agent 详情/Hook 沙箱输出若要同款渲染，直接复用 `src/lib/ansi.ts`（这是把解析器放 lib 而非组件内的原因）。
