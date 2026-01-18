import { useEffect, useState } from 'react'
import timelineController, { TimelineState, SpeedPreset } from '../engine/TimelineController'
import chapterManager from '../engine/ChapterManager'

const SPEED_LABELS: Record<SpeedPreset, string> = {
  '1min': '1m',
  '10min': '10m',
  '1hour': '1h',
  '4hours': '4h',
}

export function TimelineUI() {
  const [state, setState] = useState<TimelineState>(timelineController.getState())
  const [chapterName, setChapterName] = useState<string>('')
  const [chapterCount, setChapterCount] = useState<number>(0)

  useEffect(() => {
    const unsubTimeline = timelineController.subscribe(setState)
    const unsubChapter = chapterManager.onChapterChange((chapter) => {
      setChapterName(chapter.name)
    })
    setChapterCount(chapterManager.getChapterCount())
    
    return () => {
      unsubTimeline()
      unsubChapter()
    }
  }, [])

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    timelineController.onUserInteraction()
    timelineController.seek(parseFloat(e.target.value))
  }

  const handleSliderMouseUp = () => {
    timelineController.onUserInteractionEnd()
  }

  const handlePlayPause = () => {
    timelineController.toggle()
  }

  const handleSpeedChange = (speed: SpeedPreset) => {
    timelineController.setSpeed(speed)
  }

  return (
    <div style={styles.container}>
      <div style={styles.chapterLabel}>
        {chapterName || 'Loading...'}
      </div>
      
      <div style={styles.sliderContainer}>
        <div style={styles.tickContainer}>
          {Array.from({ length: chapterCount }).map((_, i) => (
            <div
              key={i}
              style={{
                ...styles.tick,
                left: `${(i / chapterCount) * 100}%`,
              }}
            />
          ))}
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={state.t}
          onChange={handleSliderChange}
          onMouseUp={handleSliderMouseUp}
          onTouchEnd={handleSliderMouseUp}
          style={styles.slider}
        />
      </div>

      <div style={styles.controls}>
        <button onClick={handlePlayPause} style={styles.playButton}>
          {state.playing ? '⏸' : '▶'}
        </button>
        
        <div style={styles.speedButtons}>
          {(Object.keys(SPEED_LABELS) as SpeedPreset[]).map((speed) => (
            <button
              key={speed}
              onClick={() => handleSpeedChange(speed)}
              style={{
                ...styles.speedButton,
                ...(state.speed === speed ? styles.speedButtonActive : {}),
              }}
            >
              {SPEED_LABELS[speed]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '20px 30px',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
    pointerEvents: 'none',
  },
  chapterLabel: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.7)',
    marginBottom: '12px',
    textAlign: 'center',
    fontWeight: 300,
    letterSpacing: '0.5px',
  },
  sliderContainer: {
    position: 'relative',
    height: '24px',
    pointerEvents: 'auto',
  },
  tickContainer: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: '8px',
    transform: 'translateY(-50%)',
  },
  tick: {
    position: 'absolute',
    width: '1px',
    height: '8px',
    background: 'rgba(255,255,255,0.3)',
  },
  slider: {
    width: '100%',
    height: '24px',
    cursor: 'pointer',
    background: 'transparent',
    appearance: 'none',
    WebkitAppearance: 'none',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    marginTop: '12px',
    pointerEvents: 'auto',
  },
  playButton: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.3)',
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    fontSize: '16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedButtons: {
    display: 'flex',
    gap: '4px',
  },
  speedButton: {
    padding: '6px 12px',
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    cursor: 'pointer',
    borderRadius: '4px',
  },
  speedButtonActive: {
    background: 'rgba(255,255,255,0.15)',
    color: '#fff',
    borderColor: 'rgba(255,255,255,0.4)',
  },
}

export default TimelineUI
