export interface ClaudeMDSection {
  title: string
  level: number // H1 = 1, H2 = 2, etc.
  content: string
  subsections?: ClaudeMDSection[]
}

export interface ClaudeMD {
  projectName?: string
  overview?: string
  architecture?: string
  techStack?: string[]
  keyFiles?: Array<{
    path: string
    description: string
  }>
  workflow?: string
  skills?: Array<{
    name: string
    description: string
  }>
  hooks?: Record<string, string[]>
  agents?: Array<{
    name: string
    description: string
  }>
  mcpServers?: Array<{
    name: string
    description: string
  }>
  customCommands?: Array<{
    name: string
    description: string
  }>
  importantNotes?: string
  rawContent: string
  sections: ClaudeMDSection[]
  filePath: string
  location: 'user' | 'project'
}
