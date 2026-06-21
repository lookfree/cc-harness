import { FileManagerPermissions } from './file-manager-permissions'

export class FileManager extends FileManagerPermissions {
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
