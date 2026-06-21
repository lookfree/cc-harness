import { FileManagerClaudeMd } from './file-manager-claudemd'

export class FileManager extends FileManagerClaudeMd {
  private static instance: FileManager

  private constructor() {
    super()
  }

  static getInstance(): FileManager {
    if (!FileManager.instance) {
      FileManager.instance = new FileManager()
    }
    return FileManager.instance
  }
}
