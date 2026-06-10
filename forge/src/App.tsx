import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ToolStatus {
  name: string;
  installed: boolean;
  path: string | null;
  version: string | null;
}

function App() {
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ToolStatus[]>("detect_tools")
      .then(setTools)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main
      style={{
        background: "#0f0f0f",
        color: "#e5e5e5",
        minHeight: "100vh",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Forge — 环境检测</h1>
      {error && <p style={{ color: "#ef4444" }}>{error}</p>}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {tools.map((t) => (
            <tr key={t.name} style={{ borderBottom: "1px solid #262626" }}>
              <td style={{ padding: "8px 12px" }}>
                {t.installed ? "🟢" : "⚪️"} {t.name}
              </td>
              <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>
                {t.path ?? "未安装"}
              </td>
              <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>
                {t.version ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export default App;
