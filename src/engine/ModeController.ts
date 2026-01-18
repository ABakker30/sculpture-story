export type AppMode = 'LANDING_MODE' | 'STORY_MODE'

class ModeController {
  private currentMode: AppMode = 'LANDING_MODE'
  private listeners: Set<(mode: AppMode) => void> = new Set()

  getMode(): AppMode {
    return this.currentMode
  }

  setMode(mode: AppMode): void {
    if (this.currentMode !== mode) {
      console.info(`[ModeController] Switching from ${this.currentMode} to ${mode}`)
      this.currentMode = mode
      this.notifyListeners()
    }
  }

  isLandingMode(): boolean {
    return this.currentMode === 'LANDING_MODE'
  }

  isStoryMode(): boolean {
    return this.currentMode === 'STORY_MODE'
  }

  toggleMode(): void {
    this.setMode(this.currentMode === 'LANDING_MODE' ? 'STORY_MODE' : 'LANDING_MODE')
  }

  subscribe(callback: (mode: AppMode) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentMode)
    }
  }
}

export const modeController = new ModeController()
export default modeController
