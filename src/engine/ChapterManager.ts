import * as THREE from 'three'

export interface ChapterContext {
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  getAsset: (name: string) => THREE.Object3D | undefined
  getAllAssets: (prefix: string) => THREE.Object3D[]
}

export interface Chapter {
  id: string
  name: string
  init(ctx: ChapterContext): void
  enter(): void
  update(localT: number, globalT: number): void
  exit(): void
}

export interface ChapterRange {
  start: number
  end: number
}

export type ChapterChangeListener = (chapter: Chapter, index: number) => void

class ChapterManager {
  private chapters: Chapter[] = []
  private ranges: ChapterRange[] = []
  private currentIndex: number = -1
  private context: ChapterContext | null = null
  private listeners: Set<ChapterChangeListener> = new Set()
  private initialized: boolean = false

  register(chapter: Chapter): void {
    this.chapters.push(chapter)
    this.recalculateRanges()
  }

  registerAll(chapters: Chapter[]): void {
    for (const chapter of chapters) {
      this.chapters.push(chapter)
    }
    this.recalculateRanges()
  }

  private recalculateRanges(): void {
    const count = this.chapters.length
    if (count === 0) {
      this.ranges = []
      return
    }

    this.ranges = this.chapters.map((_, i) => ({
      start: i / count,
      end: (i + 1) / count,
    }))
  }

  setContext(ctx: ChapterContext): void {
    this.context = ctx
  }

  initialize(): void {
    if (!this.context || this.initialized) return

    for (const chapter of this.chapters) {
      chapter.init(this.context)
    }
    this.initialized = true
    console.info(`[ChapterManager] Initialized ${this.chapters.length} chapters`)
  }

  update(globalT: number): void {
    if (!this.initialized || this.chapters.length === 0) return

    const targetIndex = this.getChapterIndexAt(globalT)
    
    if (targetIndex !== this.currentIndex) {
      this.transitionTo(targetIndex)
    }

    const chapter = this.chapters[this.currentIndex]
    if (chapter) {
      const range = this.ranges[this.currentIndex]
      const localT = (globalT - range.start) / (range.end - range.start)
      chapter.update(Math.max(0, Math.min(1, localT)), globalT)
    }
  }

  private getChapterIndexAt(globalT: number): number {
    for (let i = 0; i < this.ranges.length; i++) {
      const range = this.ranges[i]
      if (globalT >= range.start && globalT < range.end) {
        return i
      }
    }
    return this.chapters.length - 1
  }

  private transitionTo(index: number): void {
    if (this.currentIndex >= 0 && this.currentIndex < this.chapters.length) {
      const prevChapter = this.chapters[this.currentIndex]
      prevChapter.exit()
      console.info(`[ChapterManager] Exit: ${prevChapter.name}`)
    }

    this.currentIndex = index

    if (index >= 0 && index < this.chapters.length) {
      const nextChapter = this.chapters[index]
      nextChapter.enter()
      console.info(`[ChapterManager] Enter: ${nextChapter.name}`)
      this.notifyListeners(nextChapter, index)
    }
  }

  getCurrentChapter(): Chapter | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.chapters.length) {
      return null
    }
    return this.chapters[this.currentIndex]
  }

  getCurrentIndex(): number {
    return this.currentIndex
  }

  getChapters(): Chapter[] {
    return [...this.chapters]
  }

  getRanges(): ChapterRange[] {
    return [...this.ranges]
  }

  getChapterCount(): number {
    return this.chapters.length
  }

  onChapterChange(listener: ChapterChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(chapter: Chapter, index: number): void {
    for (const listener of this.listeners) {
      listener(chapter, index)
    }
  }

  reset(): void {
    if (this.currentIndex >= 0 && this.currentIndex < this.chapters.length) {
      this.chapters[this.currentIndex].exit()
    }
    this.currentIndex = -1
  }

  dispose(): void {
    this.reset()
    this.chapters = []
    this.ranges = []
    this.context = null
    this.listeners.clear()
    this.initialized = false
  }
}

export const chapterManager = new ChapterManager()
export default chapterManager
