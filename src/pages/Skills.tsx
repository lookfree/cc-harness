import { useEffect, useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { Skill } from '@shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Search, Plus, FileCode, BarChart3, FileText, Zap, BookOpen, Code, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { analyzeTriggers, generateExampleQueries } from '@/utils/triggerAnalyzer'
import { generateSkillDiagram, type DiagramLayout } from '@/utils/diagramGenerator'
import mermaid from 'mermaid'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import 'highlight.js/styles/github.css'

type SourceFilter = 'all' | 'user' | 'project' | 'plugin'

const SOURCE_BADGE: Record<string, string> = {
  user: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  project: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  plugin: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
}

// diagram 渲染序号：保证 mermaid.render 的 id 每次唯一（Date.now 在同毫秒会撞 id）。
let diagramRenderSeq = 0

/** skill 来源（带兼容回退）：source 优先，回退旧 location，再回退 'user'。 */
function skillSource(skill: Skill): string {
  return skill.source ?? skill.location ?? 'user'
}

/** 来源染色 Badge：user 绿 / project 蓝 / plugin 紫（plugin 显示 pluginName@version）。spec006 Commands 可复用。 */
function SourceBadge({ skill }: { skill: Skill }) {
  const { t } = useTranslation('skills')
  const src = skillSource(skill)
  const label =
    src === 'plugin' ? `${t('filter.plugin')} · ${skill.pluginName}@${skill.version}` : t(`filter.${src}`)
  return (
    <Badge variant="outline" className={cn('text-xs', SOURCE_BADGE[src])}>
      {label}
    </Badge>
  )
}

export default function Skills() {
  const { t } = useTranslation('skills')
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [diagramSvg, setDiagramSvg] = useState('')
  const [diagramError, setDiagramError] = useState('')
  const [diagramLayout, setDiagramLayout] = useState<DiagramLayout>('TD')
  const [diagramZoom, setDiagramZoom] = useState(1)
  const [diagramPan, setDiagramPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const diagramContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadSkills()
    // Initialize mermaid
    mermaid.initialize({ startOnLoad: false, theme: 'default' })
  }, [])

  const loadSkills = async () => {
    try {
      console.log('[Skills Page] Loading skills...')
      setLoading(true)
      const data = await api.skills.getAll()
      console.log('[Skills Page] Loaded', data.length, 'skills:', data)
      setSkills(data)
      if (data.length > 0 && !selectedSkill) {
        setSelectedSkill(data[0])
      }
    } catch (error) {
      console.error('[Skills Page] Failed to load skills:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredSkills = skills.filter(
    (skill) =>
      (sourceFilter === 'all' || skillSource(skill) === sourceFilter) &&
      (skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  // Analyze triggers for selected skill
  const triggerPatterns = useMemo(() => {
    if (!selectedSkill) return []
    return analyzeTriggers(selectedSkill)
  }, [selectedSkill])

  const exampleQueries = useMemo(() => {
    if (!selectedSkill) return []
    return generateExampleQueries(selectedSkill, triggerPatterns)
  }, [selectedSkill, triggerPatterns])

  // Render diagram when selected skill or layout changes
  useEffect(() => {
    let cancelled = false

    // 只在 diagram tab 激活时渲染（Radix 默认 unmount 非激活 tab）。
    // 状态驱动而非 ref+innerHTML：mermaid.render 返回 svg 存进 state 由 JSX 渲染；
    // 每次用唯一 id（固定 id 在 mermaid v11 重复 render 会残留孤儿元素、致后续渲染坏掉）；
    // 错误存进 diagramError 显式展示，不再是无声的 imperative 失败。
    if (selectedSkill && activeTab === 'diagram') {
      setDiagramError('')
      setDiagramSvg('') // 清掉上一个 skill 的图，避免新图渲染期间残影显示错 skill
      const renderDiagram = async () => {
        try {
          const diagramCode = generateSkillDiagram(selectedSkill, diagramLayout)
          const renderId = `skill-diagram-${++diagramRenderSeq}` // 自增序号，保证 mermaid id 唯一
          const { svg } = await mermaid.render(renderId, diagramCode)
          if (!cancelled) setDiagramSvg(svg)
        } catch (error) {
          console.error('Error rendering diagram:', error)
          if (!cancelled) {
            setDiagramSvg('')
            setDiagramError(error instanceof Error ? error.message : String(error))
          }
        }
      }
      renderDiagram()
    }

    return () => {
      cancelled = true
    }
  }, [selectedSkill, diagramLayout, activeTab])

  const getSkillStats = (skill: Skill) => {
    const patterns = analyzeTriggers(skill)
    return {
      references: skill.references?.length || 0,
      scripts: skill.scripts?.length || 0,
      triggers: patterns.length,
    }
  }

  // Parse and render YAML frontmatter separately with better styling
  const parseFrontmatter = (content: string): { frontmatter: string | null; body: string } => {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
    const match = content.match(frontmatterRegex)

    if (match) {
      return {
        frontmatter: match[1],
        body: content.replace(frontmatterRegex, '').trim()
      }
    }

    return { frontmatter: null, body: content }
  }

  // Diagram zoom and pan handlers
  const handleDiagramWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setDiagramZoom((prev) => Math.min(Math.max(0.1, prev * delta), 5))
  }

  const handleDiagramMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - diagramPan.x, y: e.clientY - diagramPan.y })
    }
  }

  const handleDiagramMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setDiagramPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      })
    }
  }

  const handleDiagramMouseUp = () => {
    setIsDragging(false)
  }

  const handleZoomIn = () => {
    setDiagramZoom((prev) => Math.min(prev * 1.2, 5))
  }

  const handleZoomOut = () => {
    setDiagramZoom((prev) => Math.max(prev / 1.2, 0.1))
  }

  const handleResetZoom = () => {
    setDiagramZoom(1)
    setDiagramPan({ x: 0, y: 0 })
  }

  // File upload handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault()
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0])
    }
  }

  const handleFile = async (file: File) => {
    // Check if it's a ZIP file
    if (!file.name.endsWith('.zip')) {
      alert('Please upload a ZIP file containing a SKILL.md file')
      return
    }

    // TODO: Implement actual upload logic
    console.log('Uploading file:', file.name)
    alert(`File selected: ${file.name}\nUpload functionality will be implemented soon!`)
    setUploadDialogOpen(false)
  }

  const onButtonClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="flex h-full gap-4">
      {/* Left Panel - Skills List */}
      <div className="w-80 flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">Skill Debugger</h1>
          <p className="text-sm text-muted-foreground">Browse and analyze Claude skills</p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Source filter */}
        <div className="flex gap-1">
          {(['all', 'user', 'project', 'plugin'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={sourceFilter === f ? 'default' : 'outline'}
              className="text-xs h-7 px-2"
              onClick={() => setSourceFilter(f)}
            >
              {t(`filter.${f}`)}
            </Button>
          ))}
        </div>

        {/* Skills Count */}
        <div className="text-sm text-muted-foreground px-1">
          {filteredSkills.length} of {skills.length} skills
        </div>

        {/* Skills List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {loading ? (
            <div className="text-center text-muted-foreground py-8">Loading skills...</div>
          ) : filteredSkills.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No skills found</div>
          ) : (
            filteredSkills.map((skill) => (
              <button
                key={`${skillSource(skill)}-${skill.pluginName ?? ''}-${skill.version ?? ''}-${skill.name}`}
                onClick={() => setSelectedSkill(skill)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg border transition-colors',
                  (selectedSkill?.filePath
                    ? selectedSkill.filePath === skill.filePath
                    : selectedSkill?.name === skill.name)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card hover:bg-accent border-border',
                  skill.overriddenBy && 'opacity-60'
                )}
              >
                <div className={cn('font-medium text-sm', skill.overriddenBy && 'line-through')}>
                  {skill.name}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <SourceBadge skill={skill} />
                  {skill.overriddenBy && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                      title={skill.overriddenBy}
                    >
                      {t('overridden')}
                    </Badge>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Upload Skill Button */}
        <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full">
              <Upload className="w-4 h-4 mr-2" />
              Upload skill
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Upload skill</DialogTitle>
              <DialogDescription>
                {/* Empty description to match the design */}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {/* Drag and Drop Area */}
              <div
                className={cn(
                  "relative border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer",
                  dragActive ? "border-primary bg-primary/5" : "border-gray-300 hover:border-gray-400"
                )}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={onButtonClick}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-lg border-2 border-gray-300 flex items-center justify-center">
                    <Plus className="w-6 h-6 text-gray-400" />
                  </div>
                  <p className="text-sm text-gray-600">
                    Drag and drop or click to upload
                  </p>
                </div>
              </div>

              {/* File Requirements */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-900">File requirements</p>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="inline-block w-1 h-1 rounded-full bg-gray-400 mt-2" />
                    ZIP file that includes exactly one SKILL.md file at the root level
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="inline-block w-1 h-1 rounded-full bg-gray-400 mt-2" />
                    SKILL.md contains a skill name and description formatted in YAML
                  </li>
                </ul>
              </div>

              {/* Links */}
              <div className="flex items-center gap-4 text-sm">
                <a href="#" className="text-gray-600 underline hover:text-gray-900">
                  Read more about creating skills
                </a>
                <span className="text-gray-400">or</span>
                <a href="#" className="text-gray-600 underline hover:text-gray-900">
                  see an example
                </a>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Right Panel - Skill Details */}
      <div className="flex-1 overflow-y-auto">
        {selectedSkill ? (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold">{selectedSkill.name}</h2>
                  <Badge variant={selectedSkill.enabled !== false ? 'default' : 'secondary'}>
                    {selectedSkill.enabled !== false ? 'Enabled' : 'Disabled'}
                  </Badge>
                  <SourceBadge skill={selectedSkill} />
                </div>
                <p className="text-muted-foreground mt-2">{selectedSkill.description}</p>
                {selectedSkill.overriddenBy && (
                  <div className="mt-2 text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
                    {t('overriddenNotice')}
                    <span className="opacity-70"> — {selectedSkill.overriddenBy}</span>
                  </div>
                )}
              </div>
              <Button>Edit</Button>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-6">
                <TabsTrigger value="overview" className="flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="content" className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  Content
                </TabsTrigger>
                <TabsTrigger value="triggers" className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Triggers
                </TabsTrigger>
                <TabsTrigger value="diagram" className="flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" />
                  Diagram
                </TabsTrigger>
                <TabsTrigger value="references" className="flex items-center gap-1">
                  <BookOpen className="w-3 h-3" />
                  References
                </TabsTrigger>
                <TabsTrigger value="scripts" className="flex items-center gap-1">
                  <Code className="w-3 h-3" />
                  Scripts
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-4 mt-4">
                {/* Stats Cards */}
                <div className="grid grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <BookOpen className="w-4 h-4" />
                        References
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{getSkillStats(selectedSkill).references}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Code className="w-4 h-4" />
                        Scripts
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{getSkillStats(selectedSkill).scripts}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Zap className="w-4 h-4" />
                        Triggers
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{getSkillStats(selectedSkill).triggers}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Lines
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {selectedSkill.content ? selectedSkill.content.split('\n').length : 0}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Common Triggers */}
                {selectedSkill.triggers && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Zap className="w-4 h-4" />
                        Common Triggers
                      </CardTitle>
                      <CardDescription>Actions that invoke this skill</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {selectedSkill.triggers.commands?.map((cmd) => (
                          <Badge key={cmd} variant="outline">
                            {cmd}
                          </Badge>
                        ))}
                        {selectedSkill.triggers.contexts?.map((ctx) => (
                          <Badge key={ctx} variant="secondary">
                            {ctx}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Additional Metadata */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileCode className="w-4 h-4" />
                      Additional Metadata
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">name:</span>
                      <span>{selectedSkill.name}</span>
                    </div>
                    {selectedSkill.metadata?.author && (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">author:</span>
                        <span>{selectedSkill.metadata.author}</span>
                      </div>
                    )}
                    {selectedSkill.metadata?.version && (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">version:</span>
                        <Badge variant="outline">{selectedSkill.metadata.version}</Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Content Tab */}
              <TabsContent value="content" className="mt-4">
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="p-8 max-w-4xl mx-auto">
                    {selectedSkill.content ? (
                      <div className="prose prose-base max-w-none">
                        {(() => {
                          const { frontmatter, body } = parseFrontmatter(selectedSkill.content)
                          return (
                            <>
                              {/* Render frontmatter with special styling */}
                              {frontmatter && (
                                <div className="mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 rounded-r-lg p-6 shadow-sm">
                                  <div className="flex items-center gap-2 mb-3">
                                    <FileCode className="w-4 h-4 text-blue-600" />
                                    <h3 className="text-sm font-semibold text-blue-900 uppercase tracking-wide">Skill Metadata</h3>
                                  </div>
                                  <div className="space-y-2 text-sm">
                                    {frontmatter.split('\n').map((line, idx) => {
                                      const [key, ...valueParts] = line.split(':')
                                      const value = valueParts.join(':').trim()
                                      return key && value ? (
                                        <div key={idx} className="flex items-start gap-3">
                                          <span className="font-semibold text-blue-800 min-w-[120px]">{key.trim()}:</span>
                                          <span className="text-gray-700 flex-1">{value}</span>
                                        </div>
                                      ) : null
                                    })}
                                  </div>
                                </div>
                              )}
                              {/* Render markdown body */}
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeHighlight, rehypeRaw]}
                                components={{
                                  pre: ({ children }) => (
                                    <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto border border-gray-300 my-4">
                                      {children}
                                    </pre>
                                  ),
                                  code: ({ className, children }) => {
                                    const isInline = !className
                                    return isInline ? (
                                      <code className="bg-gray-200 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800">{children}</code>
                                    ) : (
                                      <code className={className}>{children}</code>
                                    )
                                  },
                                  h1: ({ children }) => (
                                    <h1 className="text-3xl font-bold mt-8 mb-4 text-gray-900 border-b pb-2">{children}</h1>
                                  ),
                                  h2: ({ children }) => (
                                    <h2 className="text-2xl font-bold mt-6 mb-3 text-gray-900">{children}</h2>
                                  ),
                                  h3: ({ children }) => (
                                    <h3 className="text-xl font-semibold mt-5 mb-2 text-gray-800">{children}</h3>
                                  ),
                                  h4: ({ children }) => (
                                    <h4 className="text-lg font-semibold mt-4 mb-2 text-gray-800">{children}</h4>
                                  ),
                                  p: ({ children }) => <p className="mb-4 leading-7 text-gray-700">{children}</p>,
                                  ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-2">{children}</ul>,
                                  ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-2">{children}</ol>,
                                  li: ({ children }) => <li className="leading-7 text-gray-700">{children}</li>,
                                  a: ({ href, children }) => (
                                    <a href={href} className="text-blue-600 hover:text-blue-800 hover:underline" target="_blank" rel="noopener noreferrer">
                                      {children}
                                    </a>
                                  ),
                                  blockquote: ({ children }) => (
                                    <blockquote className="border-l-4 border-gray-300 pl-4 my-4 italic text-gray-600">
                                      {children}
                                    </blockquote>
                                  ),
                                  table: ({ children }) => (
                                    <div className="overflow-x-auto my-4">
                                      <table className="min-w-full divide-y divide-gray-300 border border-gray-300">
                                        {children}
                                      </table>
                                    </div>
                                  ),
                                  thead: ({ children }) => (
                                    <thead className="bg-gray-50">{children}</thead>
                                  ),
                                  tbody: ({ children }) => (
                                    <tbody className="divide-y divide-gray-200 bg-white">{children}</tbody>
                                  ),
                                  tr: ({ children }) => (
                                    <tr>{children}</tr>
                                  ),
                                  th: ({ children }) => (
                                    <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900">
                                      {children}
                                    </th>
                                  ),
                                  td: ({ children }) => (
                                    <td className="px-4 py-2 text-sm text-gray-700">{children}</td>
                                  ),
                                  hr: () => <hr className="my-6 border-gray-300" />,
                                  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                                  em: ({ children }) => <em className="italic">{children}</em>,
                                }}
                              >
                                {body}
                              </ReactMarkdown>
                            </>
                          )
                        })()}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        No content available
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Triggers Tab */}
              <TabsContent value="triggers" className="space-y-6 mt-4">
                {/* Trigger Keywords */}
                <div>
                  <h3 className="text-xl font-semibold mb-2">Trigger Keywords</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    These keywords may trigger this skill when mentioned in queries to Claude Code:
                  </p>

                  {triggerPatterns.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {triggerPatterns.map((pattern, idx) => {
                        const colors = {
                          action: 'bg-blue-100 text-blue-700',
                          technology: 'bg-purple-100 text-purple-700',
                          format: 'bg-green-100 text-green-700',
                          topic: 'bg-yellow-100 text-yellow-700',
                        }
                        return (
                          <span
                            key={idx}
                            className={`px-3 py-1 rounded-full text-sm font-medium ${colors[pattern.category]}`}
                          >
                            {pattern.keyword}
                            <span className="ml-1 text-xs opacity-75">({pattern.category})</span>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">No trigger keywords found.</p>
                  )}
                </div>

                {/* Example Queries */}
                {exampleQueries.length > 0 && (
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Example Queries</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      These example queries would likely trigger this skill:
                    </p>
                    <div className="space-y-2">
                      {exampleQueries.map((example, idx) => (
                        <div key={idx} className="p-3 bg-gray-50 rounded-md border border-gray-200">
                          <code className="text-sm text-gray-800">"{example}"</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Analysis Summary */}
                <div className="border-t pt-6">
                  <h3 className="text-lg font-medium mb-3">Analysis Summary</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <div className="text-2xl font-bold text-blue-700">
                        {triggerPatterns.filter(p => p.category === 'action').length}
                      </div>
                      <div className="text-sm text-blue-600">Action Keywords</div>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                      <div className="text-2xl font-bold text-purple-700">
                        {triggerPatterns.filter(p => p.category === 'technology').length}
                      </div>
                      <div className="text-sm text-purple-600">Technology Keywords</div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Diagram Tab */}
              <TabsContent value="diagram" className="space-y-4 mt-4">
                <div className="flex justify-between mb-4">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={diagramLayout === 'TD' ? 'default' : 'outline'}
                      onClick={() => setDiagramLayout('TD')}
                    >
                      Top-Down
                    </Button>
                    <Button
                      size="sm"
                      variant={diagramLayout === 'LR' ? 'default' : 'outline'}
                      onClick={() => setDiagramLayout('LR')}
                    >
                      Left-Right
                    </Button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Button size="sm" variant="outline" onClick={handleZoomOut}>
                      -
                    </Button>
                    <span className="text-sm text-muted-foreground min-w-[60px] text-center">
                      {Math.round(diagramZoom * 100)}%
                    </span>
                    <Button size="sm" variant="outline" onClick={handleZoomIn}>
                      +
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleResetZoom}>
                      Reset
                    </Button>
                  </div>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <div
                      ref={diagramContainerRef}
                      className="relative min-h-[400px] overflow-hidden"
                      style={{
                        maxHeight: '600px',
                        cursor: isDragging ? 'grabbing' : 'grab'
                      }}
                      onWheel={handleDiagramWheel}
                      onMouseDown={handleDiagramMouseDown}
                      onMouseMove={handleDiagramMouseMove}
                      onMouseUp={handleDiagramMouseUp}
                      onMouseLeave={handleDiagramMouseUp}
                    >
                      <div
                        className="flex items-center justify-center p-6"
                        style={{
                          transform: `translate(${diagramPan.x}px, ${diagramPan.y}px) scale(${diagramZoom})`,
                          transformOrigin: 'center center',
                          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                        }}
                      >
                        {diagramError ? (
                          <div className="text-red-500 text-sm whitespace-pre-wrap p-4">
                            {t('diagram.error')}: {diagramError}
                          </div>
                        ) : diagramSvg ? (
                          <div dangerouslySetInnerHTML={{ __html: diagramSvg }} />
                        ) : (
                          <div className="text-muted-foreground">{t('diagram.loading')}</div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* References Tab */}
              <TabsContent value="references" className="space-y-4 mt-4">
                <div className="text-sm text-muted-foreground mb-2">
                  {selectedSkill.references?.length || 0} reference(s)
                </div>
                {selectedSkill.references && selectedSkill.references.length > 0 ? (
                  <div className="space-y-2">
                    {selectedSkill.references.map((ref, idx) => (
                      <Card key={idx}>
                        <CardContent className="py-3">
                          <div className="flex items-start gap-3">
                            <FileCode className="w-4 h-4 mt-0.5 text-muted-foreground" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-xs">
                                  {ref.type}
                                </Badge>
                                <code className="text-sm">{ref.path}</code>
                              </div>
                              {ref.description && (
                                <p className="text-muted-foreground text-xs">{ref.description}</p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="py-12">
                      <div className="text-center text-muted-foreground">
                        No references found for this skill.
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Scripts Tab */}
              <TabsContent value="scripts" className="space-y-4 mt-4">
                <div className="text-sm text-muted-foreground mb-2">
                  Scripts ({selectedSkill.scripts?.length || 0})
                </div>
                {selectedSkill.scripts && selectedSkill.scripts.length > 0 ? (
                  <div className="space-y-3">
                    {selectedSkill.scripts.map((script, idx) => (
                      <Card key={idx}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">{script.name}</CardTitle>
                            <Button size="sm" variant="outline">
                              Run
                            </Button>
                          </div>
                          <CardDescription>
                            {script.description || 'No description available'}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            <div>
                              <span className="text-xs font-medium text-muted-foreground">Command:</span>
                              <code className="text-xs bg-secondary px-2 py-1 rounded block mt-1">
                                {script.command}
                              </code>
                            </div>
                            {script.content && (
                              <div>
                                <span className="text-xs font-medium text-muted-foreground">Code:</span>
                                <pre className="text-xs bg-gray-50 p-3 rounded-md mt-1 overflow-x-auto max-h-96 overflow-y-auto border border-gray-200">
                                  <code className="language-python">{script.content}</code>
                                </pre>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="py-12">
                      <div className="text-center text-muted-foreground">
                        No scripts found for this skill.
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a skill to view details
          </div>
        )}
      </div>
    </div>
  )
}
