export type SpeedPreset = '1min' | '10min' | '1hour' | '4hours'

export interface TimelineState {
  t: number
  playing: boolean
  speed: SpeedPreset
  duration: number
}

export type TimelineListener = (state: TimelineState) => void

const SPEED_DURATIONS: Record<SpeedPreset, number> = {
  '1min': 60 * 1000,
  '10min': 10 * 60 * 1000,
  '1hour': 60 * 60 * 1000,
  '4hours': 4 * 60 * 60 * 1000,
}

class TimelineController {
  private _t: number = 0
  private _playing: boolean = false
  private _speed: SpeedPreset = '1min'
  private _lastTime: number = 0
  private _animationFrame: number | null = null
  private _listeners: Set<TimelineListener> = new Set()
  private _userInteracting: boolean = false

  get t(): number {
    return this._t
  }

  set t(value: number) {
    this._t = Math.max(0, Math.min(1, value))
    this.notifyListeners()
  }

  get playing(): boolean {
    return this._playing
  }

  get speed(): SpeedPreset {
    return this._speed
  }

  get duration(): number {
    return SPEED_DURATIONS[this._speed]
  }

  play(): void {
    if (this._playing) return
    this._playing = true
    this._lastTime = performance.now()
    this.tick()
    this.notifyListeners()
  }

  pause(): void {
    if (!this._playing) return
    this._playing = false
    if (this._animationFrame !== null) {
      cancelAnimationFrame(this._animationFrame)
      this._animationFrame = null
    }
    this.notifyListeners()
  }

  toggle(): void {
    if (this._playing) {
      this.pause()
    } else {
      this.play()
    }
  }

  setSpeed(speed: SpeedPreset): void {
    this._speed = speed
    this.notifyListeners()
  }

  seek(t: number): void {
    this.t = t
  }

  reset(): void {
    this.pause()
    this._t = 0
    this.notifyListeners()
  }

  onUserInteraction(): void {
    this._userInteracting = true
    if (this._playing) {
      this.pause()
      console.info('[TimelineController] Autoplay paused due to user interaction')
    }
  }

  onUserInteractionEnd(): void {
    this._userInteracting = false
  }

  isUserInteracting(): boolean {
    return this._userInteracting
  }

  subscribe(listener: TimelineListener): () => void {
    this._listeners.add(listener)
    listener(this.getState())
    return () => this._listeners.delete(listener)
  }

  getState(): TimelineState {
    return {
      t: this._t,
      playing: this._playing,
      speed: this._speed,
      duration: this.duration,
    }
  }

  private tick = (): void => {
    if (!this._playing) return

    const now = performance.now()
    const delta = now - this._lastTime
    this._lastTime = now

    const increment = delta / this.duration
    this._t = Math.min(1, this._t + increment)

    if (this._t >= 1) {
      this._t = 1
      this.pause()
    }

    this.notifyListeners()
    
    if (this._playing) {
      this._animationFrame = requestAnimationFrame(this.tick)
    }
  }

  private notifyListeners(): void {
    const state = this.getState()
    for (const listener of this._listeners) {
      listener(state)
    }
  }

  dispose(): void {
    this.pause()
    this._listeners.clear()
  }
}

export const timelineController = new TimelineController()
export default timelineController
