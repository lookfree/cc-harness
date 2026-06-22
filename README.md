# Claude Code Debugger & Manager

A powerful application for debugging and managing Claude Code skills, agents, hooks, MCP servers, and slash commands. Supports both **Desktop (Electron)** and **Web** modes.

## Features

- **Skills Browser**: Browse, search, and analyze Claude Code skills with detailed information including triggers, scripts, and references
- **Agents Manager**: Manage and debug Claude Code subagents
- **Hooks Manager**: Configure, test, and debug hook execution chains with real-time execution logs
  - Support for all hook types: SessionStart, SessionEnd, PreToolUse, PostToolUse, etc.
  - Launch debug sessions in external terminal
  - View execution logs with detailed output
- **MCP Server Manager**: Manage Model Context Protocol servers and test connections
- **Commands Manager**: Create and edit custom slash commands with syntax highlighting
- **CLAUDE.md Manager**: Browse and edit CLAUDE.md files across multiple projects
- **Dependency Graph**: Visualize component dependencies and relationships
- **Visual Editors**: Edit configurations through intuitive UI with Monaco Editor
- **Multi-language Support**: Full i18n support for English and Chinese

## Running Modes

The application supports two running modes:

| Mode | Command | Description |
|------|---------|-------------|
| **Desktop (Electron)** | `npm run electron:dev` | Full-featured desktop application |
| **Web** | `npm run web:dev` | Browser-based access with Express API backend |

### Web Mode Limitations

Some features are only available in Desktop mode:
- Launch debug sessions (requires local terminal)
- Hook testing (security reasons)
- MCP connection testing
- File watching
- Project path selection dialog

## Technology Stack

- **Desktop**: Electron
- **Backend (Web)**: Express.js
- **Frontend**: React 18 + TypeScript
- **UI**: shadcn/ui + Tailwind CSS + Radix UI
- **State**: Zustand
- **Visualization**: React Flow
- **Editor**: Monaco Editor
- **i18n**: i18next
- **Build**: Vite

## Project Structure

```
claude-code-debugger/
├── electron/              # Electron main process
│   ├── main.ts           # Main entry point
│   ├── preload.cjs       # Preload script (CommonJS)
│   ├── ipc/              # IPC handlers (modular)
│   │   ├── index.ts      # Main IPC registry
│   │   ├── skills.ts     # Skills IPC handlers
│   │   ├── hooks.ts      # Hooks IPC handlers
│   │   ├── mcp.ts        # MCP IPC handlers
│   │   ├── commands.ts   # Commands IPC handlers
│   │   ├── agents.ts     # Agents IPC handlers
│   │   ├── claudemd.ts   # CLAUDE.md IPC handlers
│   │   └── providers.ts  # AI Provider IPC handlers
│   └── services/         # Backend services
│       └── file-manager.ts  # File system operations
├── server/               # Express API server (Web mode)
│   └── index.ts          # API routes
├── src/                  # React frontend
│   ├── App.tsx          # Main app component
│   ├── main.tsx         # Entry point
│   ├── i18n/            # Internationalization
│   │   ├── index.ts     # i18n configuration
│   │   └── locales/     # Translation files
│   ├── pages/           # Page components
│   │   ├── Dashboard.tsx
│   │   ├── Skills.tsx
│   │   ├── Agents.tsx
│   │   ├── Hooks.tsx
│   │   ├── MCP.tsx
│   │   ├── Commands.tsx
│   │   ├── ClaudeMd.tsx
│   │   ├── Graph.tsx
│   │   ├── Models.tsx
│   │   └── Settings.tsx
│   ├── components/      # Reusable UI components
│   │   ├── layout/
│   │   └── ui/          # shadcn/ui components
│   ├── stores/          # State management
│   └── lib/             # Utilities and API client
│       ├── api.ts       # Unified API (Electron IPC / HTTP)
│       └── utils.ts
├── shared/              # Shared TypeScript types
│   └── types/
├── vite.config.ts       # Vite config (Electron mode)
├── vite.config.web.ts   # Vite config (Web mode)
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/lookfree/cc-harness.git
cd cc-harness

# Install dependencies
npm install
```

### Development

```bash
# Desktop mode (Electron + Vite hot reload)
npm run electron:dev

# Web mode (Express API + Vite)
npm run web:dev
```

### Building

```bash
# Build Desktop app for production
npm run electron:build

# Build Web app for production
npm run web:build
```

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server only |
| `npm run electron:dev` | Start Electron desktop app with hot reload |
| `npm run electron:build` | Build Electron app for distribution |
| `npm run web:dev` | Start Web mode (Express API + Vite frontend) |
| `npm run web:build` | Build Web frontend for production |
| `npm run server` | Start Express API server only |
| `npm run build` | Build for production |
| `npm run lint` | Run ESLint |

## Configuration

The app reads configuration from:
- **Project**: `.claude/` directory in your project
- **Global**: `~/.claude/` in your home directory

Supported configuration files:
- `settings.json` - Claude Code settings including hooks
- `skills/*.json` or `SKILL.md` - Skill definitions
- `agents/*.json` - Agent configurations
- `hooks/*.json` - Hook definitions (legacy format)
- `commands/<name>/<name>.md` - Slash command definitions
- `claude_mcp_config.json` - MCP server configurations
- `CLAUDE.md` - Project documentation

## API Endpoints (Web Mode)

The Express API server provides RESTful endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/skills` | List all skills |
| `GET /api/hooks` | List all hooks |
| `GET /api/commands` | List all commands |
| `GET /api/mcp` | List MCP servers |
| `GET /api/claudemd/all` | List all CLAUDE.md files |
| `GET /api/project/context` | Get project context |

## Architecture

### Electron Mode

```
Frontend (React)
    ↓ window.electronAPI.getSkills()
Preload Script (contextBridge)
    ↓ ipcRenderer.invoke('skills:getAll')
Main Process (IPC Handlers)
    ↓ FileManager.getSkills()
File System (~/.claude/)
```

### Web Mode

```
Frontend (React)
    ↓ fetch('/api/skills')
Express API Server
    ↓ FileManager.getSkills()
File System (~/.claude/)
```

### Unified API Client

The `src/lib/api.ts` automatically detects the running environment and uses the appropriate backend:

```typescript
import { api } from '@/lib/api'

// Works in both Electron and Web modes
const skills = await api.skills.getAll()
const hooks = await api.hooks.getAll()
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Author

Built with Claude Code for the Claude Code community
