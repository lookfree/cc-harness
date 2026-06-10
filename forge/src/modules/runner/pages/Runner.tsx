import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import LaunchBar from "../components/LaunchBar";
import TerminalTab, { TabHeader } from "../components/TerminalTab";
import { launchStore } from "../../../lib/launchStore";

interface TabInfo {
  sessionId: string;
  tool: string;
  exited: boolean;
}

export default function Runner() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Consume launch-request from Sessions/Projects pages (on mount + subscription)
  useEffect(() => {
    const req = launchStore.consume()
    if (req) {
      invoke<string>("pty_create", { tool: req.tool, workingDir: req.workingDir, extraArgs: req.extraArgs })
        .then((sessionId) => {
          const newTab: TabInfo = { sessionId, tool: req.tool, exited: false };
          setTabs((prev) => {
            const next = [...prev, newTab];
            setActiveIdx(next.length - 1);
            return next;
          });
        })
        .catch((e) => setError(String(e)));
    }
  }, []);

  useEffect(() => {
    return launchStore.subscribe((req) => {
      if (!req) return;
      const consumed = launchStore.consume();
      if (consumed) {
        invoke<string>("pty_create", { tool: consumed.tool, workingDir: consumed.workingDir, extraArgs: consumed.extraArgs })
          .then((sessionId) => {
            const newTab: TabInfo = { sessionId, tool: consumed.tool, exited: false };
            setTabs((prev) => {
              const next = [...prev, newTab];
              setActiveIdx(next.length - 1);
              return next;
            });
          })
          .catch((e) => setError(String(e)));
      }
    });
  }, []);

  async function handleLaunch(tool: string, workingDir: string) {
    setError(null);
    try {
      const sessionId = await invoke<string>("pty_create", { tool, workingDir });
      const newTab: TabInfo = { sessionId, tool, exited: false };
      setTabs((prev) => {
        const next = [...prev, newTab];
        setActiveIdx(next.length - 1);
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleClose(idx: number) {
    const tab = tabs[idx];
    try {
      await invoke("pty_kill", { sessionId: tab.sessionId });
    } catch {
      // best effort
    }
    setTabs((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setActiveIdx((ai) => Math.min(ai, Math.max(0, next.length - 1)));
      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <LaunchBar onLaunch={handleLaunch} />

      {error && (
        <div
          style={{
            padding: "6px 16px",
            background: "#1c1c1c",
            color: "#ef4444",
            fontSize: 12,
            borderBottom: "1px solid #262626",
          }}
        >
          {error}
        </div>
      )}

      {tabs.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#4b5563",
            fontSize: 14,
          }}
        >
          Select a tool and a working directory, then click Launch.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}
        >
          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              padding: "8px 12px 0",
              borderBottom: "1px solid #262626",
              background: "#141414",
              flexShrink: 0,
              overflowX: "auto",
            }}
          >
            {tabs.map((tab, i) => (
              <TabHeader
                key={tab.sessionId}
                sessionId={tab.sessionId}
                tool={tab.tool}
                exited={tab.exited}
                active={i === activeIdx}
                onSelect={() => setActiveIdx(i)}
                onClose={() => handleClose(i)}
              />
            ))}
          </div>

          {/* Terminal panels — all mounted, hidden with CSS when inactive */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {tabs.map((tab, i) => (
              <div
                key={tab.sessionId}
                style={{
                  position: "absolute",
                  inset: 0,
                  visibility: i === activeIdx ? "visible" : "hidden",
                }}
              >
                <TerminalTab
                  sessionId={tab.sessionId}
                  active={i === activeIdx}
                  onExited={() => {
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.sessionId === tab.sessionId
                          ? { ...t, exited: true }
                          : t
                      )
                    );
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
