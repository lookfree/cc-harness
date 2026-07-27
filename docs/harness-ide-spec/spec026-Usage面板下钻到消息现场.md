# spec026 · Usage 面板下钻到消息现场

- 对应功能 ID：OBS-02 增补（spec017 Token 面板的下钻闭环）
- 所属 Phase：P2
- 前置依赖：spec017（Token-Usage 面板）、spec015（onSeek → Replay 跳转链路）
- 工作量估计：S（<1天）

## 目标

在 Usage 面板看到某个 bucket / 某个时点花费异常时，能**一键跳到对话现场**（Replay 对应消息卡片）——补上"成本异常 → 现场取证"这最后一跳，成本优化器的故事才闭环。目前只能从 Timeline 和拓扑进 Replay，Usage 面板是死胡同。

## 现状

- **跳转链路已存在且只差接线**：`src/pages/Sessions.tsx:52-55` 的 `onSeek(seq)` 会 `setSeekSeq + setTab('replay')`；`ConversationReplay.tsx:58-68` 按 `data-seq` 滚动定位。Timeline 已用这条链，`SessionUsage` 没接。
- **series 点没带 seq**：`shared/types/session.ts:127-137` 的 `UsageSeriesPoint` 只有 ts/bucket/model/output/inputBillable/costUsd。而后端 `electron/services/session/usage-breakdown.ts:106` 生成主会话点时手里就有 `AssistantTurnEvent.seq`（`session.ts:18`），白白丢掉。
- **subagent 点天然无主会话 seq**：`usage-breakdown.ts:110-125` 的 subagents 点来自拓扑 agent 汇总（独立 jsonl），在主对话里没有对应卡片，不能跳 Replay——但拓扑页签有它们的节点。
- **饼图/面积图目前纯展示**：`SessionUsage.tsx:105-128` 无任何 onClick。

## 改动方案

### 1. 类型（`shared/types/session.ts`）

```ts
export interface UsageSeriesPoint {
  // ...现有字段不动
  /** 主会话 assistant turn 的 seq（跳 Replay 用）；subagent 汇总点无 → undefined */
  seq?: number
}
```

### 2. 后端（`electron/services/session/usage-breakdown.ts`）

`seriesPoint()` 加第 5 参 `seq?: number` 塞进返回值；`computeUsageBreakdown` 主循环（:106）传 `e.seq`，拓扑 subagent 分支（:123）不传。纯增量，旧字段/排序不动。

### 3. 前端（`src/components/sessions/SessionUsage.tsx`）

- Props 加 `onSeek?: (seq: number) => void`、`onOpenTopology?: () => void`。
- **饼图下钻**：Pie slice `onClick` → `setDrillBucket(bucket)`（再点同一扇区收起）。下方渲染榜单卡片：该 bucket 的 series 点按 `costUsd` 降序取 Top 10，列 = turn（`#seq`）/ 时间 / model / output / 成本；有 `seq` 的行可点 → `onSeek(seq)`。`drillBucket==='subagents'` 时榜单头部放"在拓扑中查看"按钮 → `onOpenTopology()`，行不可点。
- **面积图直跳**：`cumSeries` 透传 `seq`；`AreaChart onClick` 取 `activePayload[0].payload.seq`，有则 `onSeek(seq)`。
- 无 `onSeek`（理论兜底）时保持现状纯展示。

### 4. 接线（`src/pages/Sessions.tsx`）

```tsx
<SessionUsage ... onSeek={onSeek} onOpenTopology={() => setTab('topology')} />
```

### 5. i18n（`src/i18n/locales/{en,zh}/sessions.json`）

`usage.drill.*`：`title`（"{{bucket}} 最贵 turns"）、`col.turn/time/output/cost`、`viewInTopology`、`clickHint`、`empty`。en/zh 成对。

## 实现步骤

- [x] 1. `shared/types/session.ts`：`UsageSeriesPoint.seq?: number`。
- [x] 2. `usage-breakdown.ts`：`seriesPoint` 加 seq 参数，主会话传 `e.seq`。
- [x] 3. `SessionUsage.tsx`：drillBucket 状态 + 榜单卡片 + Pie/Area onClick + 两个新 props。
- [x] 4. `Sessions.tsx`：传 `onSeek` / `onOpenTopology`。
- [x] 5. i18n：en/zh `usage.drill.*` 成对补齐。
- [x] 6. `npx tsc --noEmit` 通过。

## 验收标准

- [x] 点饼图任一扇区 → 下方出现该 bucket Top-10 最贵 turn 榜单；再点同扇区收起。
- [x] 点榜单某行（非 subagents）→ 切到 Replay 页签并滚动到对应 `data-seq` 卡片可见（现有 scrollToSeq 机制只滚动不高亮，本 spec 不加高亮）。
- [x] 点累计烧钱图任一点 → 同上直跳该 turn。
- [x] subagents 榜单行不可点，但"在拓扑中查看"按钮切到拓扑页签。
- [x] Web 模式下钻同样可用（纯前端跳转，不涉桌面端专属能力）。
- [x] en/zh 键成对，无硬编码文案；`npx tsc --noEmit` 0 错误。

## 风险与备注

- subagent 点将来若想精确跳到拓扑对应节点（而非仅切页签），需在 series 点带 `agentId` 并给 `AgentTopologyView` 加定位 API——本 spec 不做（YAGNI，切页签已够用）。
- recharts `Pie.onClick` 第一参即 slice datum（含自定义字段），`AreaChart.onClick` 走 `activePayload`——均为 recharts 2.x 稳定 API。
- ANSI 颜色渲染（本批评估的缺口 2）不在本 spec，另行排期。
