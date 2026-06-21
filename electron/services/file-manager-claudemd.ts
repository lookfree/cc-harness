import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { FileManagerCommands } from './file-manager-commands'

export class FileManagerClaudeMd extends FileManagerCommands {
  // Constants for security and performance
  private readonly MAX_SCAN_DEPTH = 3
  private readonly MAX_FILES_TO_SCAN = 1000
  private readonly SCAN_TIMEOUT_MS = 10000 // 10 seconds
  private readonly ALLOWED_SCAN_ROOTS = [
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Projects'),
    path.join(os.homedir(), 'Developer'),
    path.join(os.homedir(), 'dev'),
    path.join(os.homedir(), 'workspace'),
    path.join(os.homedir(), 'code'),
    path.join(os.homedir(), 'src'),
  ]

  // Skip these directories for security and performance
  private readonly SKIP_DIRECTORIES = new Set([
    'node_modules',
    'vendor',
    'dist',
    'build',
    'out',
    'target',
    '__pycache__',
    'venv',
    'env',
    '.git',
    '.svn',
    '.hg',
    'bower_components',
  ])

  // CLAUDE.md
  async getClaudeMDFiles(): Promise<Array<{ content: string; location: 'user' | 'project' | 'global'; filePath: string; exists: boolean; projectName?: string }>> {
    this.logger.info('getClaudeMDFiles() called')
    const files = []

    // Global CLAUDE.md (in user config)
    const globalPath = path.join(this.userConfigPath, 'CLAUDE.md')
    this.logger.info('Checking global CLAUDE.md at:', globalPath)
    try {
      const content = await fs.readFile(globalPath, 'utf-8')
      this.logger.info('Global CLAUDE.md exists, length:', content.length)
      files.push({ content, location: 'global' as const, filePath: globalPath, exists: true })
    } catch (error) {
      this.logger.info('Global CLAUDE.md does not exist')
      files.push({ content: '', location: 'global' as const, filePath: globalPath, exists: false })
    }

    // Auto-discover all project CLAUDE.md files
    const projectClaudeMdFiles = await this.discoverProjectClaudeMDs()
    this.logger.info('Discovered', projectClaudeMdFiles.length, 'project CLAUDE.md files')
    files.push(...projectClaudeMdFiles)

    this.logger.info('Returning', files.length, 'CLAUDE.md files')
    return files
  }

  private async discoverProjectClaudeMDs(): Promise<Array<{ content: string; location: 'project'; filePath: string; exists: boolean; projectName: string }>> {
    const discovered = []
    const homeDir = os.homedir()

    this.logger.info('Auto-discovering CLAUDE.md files in development directories...')

    // Use timeout to prevent hanging
    const scanPromises = this.ALLOWED_SCAN_ROOTS.map(async (root) => {
      try {
        await fs.access(root)

        // Verify root is within allowed paths (security check)
        const resolvedRoot = await fs.realpath(root).catch(() => null)
        if (!resolvedRoot) {
          this.logger.warn(`Skipping invalid path: ${root}`)
          return []
        }

        // Check if path is still within home directory after resolving symlinks
        if (!resolvedRoot.startsWith(homeDir)) {
          this.logger.warn(`Security: Skipping path outside home directory: ${resolvedRoot}`)
          return []
        }

        const foundFiles = await this.scanForClaudeMD(resolvedRoot, this.MAX_SCAN_DEPTH)
        return foundFiles
      } catch (error) {
        // Directory doesn't exist or no permission, skip
        return []
      }
    })

    // Apply timeout to entire scan operation
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Scan timeout')), this.SCAN_TIMEOUT_MS)
    )

    try {
      const results = await Promise.race([
        Promise.all(scanPromises),
        timeoutPromise
      ])

      for (const files of results) {
        discovered.push(...files)
      }
    } catch (error) {
      this.logger.error('Scan timeout or error:', error)
    }

    // Remove duplicates based on filePath
    const uniqueFiles = new Map<string, typeof discovered[0]>()
    for (const file of discovered) {
      if (!uniqueFiles.has(file.filePath)) {
        uniqueFiles.set(file.filePath, file)
      }
    }

    this.logger.info(`Discovered ${uniqueFiles.size} unique CLAUDE.md files`)
    return Array.from(uniqueFiles.values())
  }

  private async scanForClaudeMD(
    dir: string,
    maxDepth: number,
    currentDepth = 0,
    scannedCount = { count: 0 }
  ): Promise<Array<{ content: string; location: 'project'; filePath: string; exists: boolean; projectName: string }>> {
    const results: Array<{ content: string; location: 'project'; filePath: string; exists: boolean; projectName: string }> = []

    // Stop if max depth exceeded
    if (currentDepth > maxDepth) {
      return results
    }

    // Stop if scanned too many directories (performance protection)
    if (scannedCount.count >= this.MAX_FILES_TO_SCAN) {
      this.logger.warn(`Reached max scan limit of ${this.MAX_FILES_TO_SCAN} files`)
      return results
    }

    try {
      scannedCount.count++

      // Security: Detect and skip symbolic links to prevent path traversal
      const dirStat = await fs.lstat(dir)
      if (dirStat.isSymbolicLink()) {
        this.logger.warn(`Skipping symbolic link for security: ${dir}`)
        return results
      }

      const entries = await fs.readdir(dir, { withFileTypes: true })

      // Check if CLAUDE.md exists in current directory
      const claudeMdPath = path.join(dir, 'CLAUDE.md')
      try {
        const content = await fs.readFile(claudeMdPath, 'utf-8')
        const projectName = path.basename(dir)
        this.logger.info(`Found CLAUDE.md in: ${dir}`)
        results.push({
          content,
          location: 'project' as const,
          filePath: claudeMdPath,
          exists: true,
          projectName
        })
      } catch {
        // No CLAUDE.md in this directory
      }

      // Recursively scan subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const entryName = entry.name

          // Skip directories that start with . or are in skip list
          if (entryName.startsWith('.') || this.SKIP_DIRECTORIES.has(entryName)) {
            continue
          }

          // Check for max files limit before recursing
          if (scannedCount.count >= this.MAX_FILES_TO_SCAN) {
            break
          }

          const subDir = path.join(dir, entryName)

          // Security: Check if subdirectory is a symbolic link
          try {
            const subDirStat = await fs.lstat(subDir)
            if (subDirStat.isSymbolicLink()) {
              this.logger.warn(`Skipping symbolic link: ${subDir}`)
              continue
            }
          } catch {
            continue // Skip if can't stat
          }

          const subResults = await this.scanForClaudeMD(subDir, maxDepth, currentDepth + 1, scannedCount)
          results.push(...subResults)
        }
      }
    } catch (error) {
      // Permission denied or other error, skip this directory
      this.logger.warn(`Error scanning directory ${dir}:`, error instanceof Error ? error.message : 'Unknown error')
    }

    return results
  }

  async getClaudeMD(): Promise<string> {
    const projectPath = path.join(this.projectPath, 'CLAUDE.md')
    const userPath = path.join(this.userConfigPath, 'CLAUDE.md')

    try {
      return await fs.readFile(projectPath, 'utf-8')
    } catch {
      try {
        return await fs.readFile(userPath, 'utf-8')
      } catch {
        return ''
      }
    }
  }

  async saveClaudeMD(content: string, location: 'user' | 'project' = 'project'): Promise<void> {
    const filePath = location === 'project'
      ? path.join(this.projectPath, 'CLAUDE.md')
      : path.join(this.userConfigPath, 'CLAUDE.md')

    await fs.writeFile(filePath, content, 'utf-8')
  }
}
