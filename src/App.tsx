import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import Skills from './pages/Skills'
import Plugins from './pages/Plugins'
import Agents from './pages/Agents'
import Hooks from './pages/Hooks'
import Permissions from './pages/Permissions'
import MCP from './pages/MCP'
import Commands from './pages/Commands'
import ClaudeMd from './pages/ClaudeMd'
import Graph from './pages/Graph'
import Models from './pages/Models'
import Settings from './pages/Settings'
import Sessions from './pages/Sessions'
import Memory from './pages/Memory'
import Loops from './pages/Loops'

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/claude-md" element={<ClaudeMd />} />
          <Route path="/commands" element={<Commands />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/mcp" element={<MCP />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/plugins" element={<Plugins />} />
          <Route path="/hooks" element={<Hooks />} />
          <Route path="/permissions" element={<Permissions />} />
          <Route path="/models" element={<Models />} />
          <Route path="/graph" element={<Graph />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/loops" element={<Loops />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App
