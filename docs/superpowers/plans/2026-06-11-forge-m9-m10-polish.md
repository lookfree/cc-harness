# Forge M9+M10 整合与打磨实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Forge 的前端整合收尾与发布打磨：全应用终审、错误状态补齐、打包配置验证、发布构建冒烟、项目 README。

**Architecture:** 不引入新模块。M9 的 tauri.ts、导航 Shell、模块注册已在 M2–M8 增量完成；本阶段以"审查发现 → 修复"为主线，最后产出可分发的 .app/.dmg。

**Tech Stack:** 既有栈（Tauri v2 / React TS / Rust）。

**Scope 备注（偏差记录）：**
- i18n：基础设施（i18next + 旧版翻译文件）已在 M4 引入，但 M2–M8 新页面文案以中文硬编码为主。完整中英双语切换推迟到后续版本（v1 缺口，记入 README 已知限制）。
- Monaco Editor：spec 中 Codex/OpenCode Config 页用 Monaco；v1 用受控 textarea 实现（M7 已记录该简化）。
- M4 重写页面缺失的功能清单（Markdown 预览、Mermaid 图、Hook 编辑表单等）见 M4 审查报告，记入 README 已知限制。

---

### Task 1: 全应用终审（审查代理）

- [ ] **Step 1:** 派终审子代理：跨模块审查导航完整性（每个 nav 项有页面、每个页面可达）、命令注册完整性（tauri.ts ↔ lib.rs 全量 diff）、错误状态覆盖（工具未安装/配置缺失/写入失败的 UI 表现）、spec 里程碑对照表（M0–M8 每项功能指认实现位置）
- [ ] **Step 2:** 修复终审发现的 Critical/Important 问题（修复代理或直接修复）
- [ ] **Step 3:** `cargo test` + `npm run build` 全绿后提交

### Task 2: 打包配置验证

- [ ] **Step 1:** 检查 `forge/src-tauri/tauri.conf.json`：productName=Forge、identifier=com.forge-dev.app、bundle targets 含 dmg（macOS）
- [ ] **Step 2:** 提交（如有改动）

### Task 3: 发布构建冒烟

- [ ] **Step 1:** `cd forge && npm run tauri build` — 预期产出 `src-tauri/target/release/bundle/macos/Forge.app` 与 dmg，退出码 0
- [ ] **Step 2:** `open` Forge.app 手动冒烟（GUI 环境下：窗口出现、Dashboard 渲染、托盘图标出现）——无 GUI 时记录跳过

### Task 4: 项目 README

- [ ] **Step 1:** 写 `forge/README.md`：项目简介、功能清单（按里程碑）、开发（npm install / npm run tauri dev）、构建（npm run tauri build）、测试（cargo test）、已知限制（i18n、Monaco、M4 简化清单、OpenCode 已移出范围）
- [ ] **Step 2:** 提交并推送全部

## Self-Review

- Spec 覆盖：M9（整合）已散布在 M2–M8 完成，此处只查漏；M10（错误状态/安装引导/打包/冒烟）对应 Task 1–3。
- 无占位符；Task 1 审查范围明确列举。
