import { useState } from "react";
import Navigation from "./shell/Navigation";
import Dashboard from "./modules/dashboard/pages/Dashboard";
import Runner from "./modules/runner/pages/Runner";
import Providers from "./modules/model-switcher/pages/Providers";
import Presets from "./modules/model-switcher/pages/Presets";
import Skills from "./modules/claude-code/pages/Skills";
import Agents from "./modules/claude-code/pages/Agents";
import Hooks from "./modules/claude-code/pages/Hooks";
import MCP from "./modules/claude-code/pages/MCP";
import Commands from "./modules/claude-code/pages/Commands";
import ClaudeMd from "./modules/claude-code/pages/ClaudeMd";
import Graph from "./modules/claude-code/pages/Graph";
import Git from "./modules/claude-code/pages/Git";
import Worktrees from "./modules/claude-code/pages/Worktrees";
import Environment from "./modules/claude-code/pages/Environment";

type PageId =
  | "dashboard"
  | "runner"
  | "providers"
  | "presets"
  | "cc_skills"
  | "cc_agents"
  | "cc_hooks"
  | "cc_mcp"
  | "cc_commands"
  | "cc_claudemd"
  | "cc_graph"
  | "cc_git"
  | "cc_worktrees"
  | "cc_environment";

function renderPage(id: PageId) {
  switch (id) {
    case "dashboard":
      return <Dashboard />;
    case "runner":
      return <Runner />;
    case "providers":
      return <Providers />;
    case "presets":
      return <Presets />;
    case "cc_skills":
      return <Skills />;
    case "cc_agents":
      return <Agents />;
    case "cc_hooks":
      return <Hooks />;
    case "cc_mcp":
      return <MCP />;
    case "cc_commands":
      return <Commands />;
    case "cc_claudemd":
      return <ClaudeMd />;
    case "cc_graph":
      return <Graph />;
    case "cc_git":
      return <Git />;
    case "cc_worktrees":
      return <Worktrees />;
    case "cc_environment":
      return <Environment />;
    default:
      return <Dashboard />;
  }
}

function App() {
  const [page, setPage] = useState<PageId>("dashboard");

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "#0f0f0f",
        color: "#e5e5e5",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <Navigation activeId={page} onNavigate={(id) => setPage(id as PageId)} />
      <main style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {renderPage(page)}
      </main>
    </div>
  );
}

export default App;
