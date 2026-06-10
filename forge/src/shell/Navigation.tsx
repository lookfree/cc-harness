interface NavItem {
  id: string;
  label: string;
  isGroupHeader?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "runner", label: "CLI Runner" },
  { id: "_group_model_switcher", label: "Model Switcher", isGroupHeader: true },
  { id: "providers", label: "Providers" },
  { id: "presets", label: "Presets" },
  { id: "_group_claude_code", label: "Claude Code", isGroupHeader: true },
  { id: "cc_sessions", label: "Sessions" },
  { id: "cc_projects", label: "Projects" },
  { id: "cc_skills", label: "Skills" },
  { id: "cc_agents", label: "Agents" },
  { id: "cc_hooks", label: "Hooks" },
  { id: "cc_mcp", label: "MCP" },
  { id: "cc_commands", label: "Commands" },
  { id: "cc_claudemd", label: "CLAUDE.md" },
  { id: "cc_graph", label: "Dependency Graph" },
  { id: "cc_git", label: "Git" },
  { id: "cc_worktrees", label: "Worktrees" },
  { id: "cc_environment", label: "Environment" },
  { id: "_group_codex_cli", label: "Codex CLI", isGroupHeader: true },
  { id: "codex_overview", label: "Overview" },
  { id: "codex_sessions", label: "Sessions" },
  { id: "codex_projects", label: "Projects" },
  { id: "codex_config", label: "Config" },
  { id: "command_ref", label: "Command Ref" },
];

interface NavigationProps {
  activeId: string;
  onNavigate: (id: string) => void;
}

export default function Navigation({ activeId, onNavigate }: NavigationProps) {
  return (
    <nav
      style={{
        width: 240,
        flexShrink: 0,
        background: "#0f0f0f",
        borderRight: "1px solid #1f1f1f",
        display: "flex",
        flexDirection: "column",
        padding: "16px 0",
        height: "100vh",
        boxSizing: "border-box",
      }}
    >
      {/* App title */}
      <div
        style={{
          padding: "0 20px 20px",
          fontSize: 16,
          fontWeight: 700,
          color: "#e5e5e5",
          letterSpacing: 1,
          borderBottom: "1px solid #1f1f1f",
          marginBottom: 8,
        }}
      >
        FORGE
      </div>

      {/* Nav items */}
      {NAV_ITEMS.map((item) => {
        if (item.isGroupHeader) {
          return (
            <div
              key={item.id}
              style={{
                padding: "16px 20px 4px",
                fontSize: 10,
                fontWeight: 700,
                color: "#4b5563",
                textTransform: "uppercase",
                letterSpacing: 1.5,
              }}
            >
              {item.label}
            </div>
          );
        }
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: isActive ? "#1e3a5f" : "transparent",
              color: isActive ? "#3b82f6" : "#a3a3a3",
              border: "none",
              borderLeft: `3px solid ${isActive ? "#3b82f6" : "transparent"}`,
              padding: "9px 20px",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              transition: "background 0.1s, color 0.1s",
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLButtonElement).style.background = "#141414";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
