import { useState, useEffect, useRef } from 'react'

interface CameraAnimationModalProps {
  isOpen: boolean
  onClose: () => void
  onSettingsChange?: (settings: CameraAnimationSettings) => void
  onPlay?: (settings: CameraAnimationSettings) => void
  isPlaying?: boolean
  showHull?: boolean
  onShowHullChange?: (show: boolean) => void
}

export interface CameraAnimationSettings {
  duration: number
  viewpointTypes: {
    corner: boolean
    edge: boolean
    face: boolean
  }
  lookAhead: number
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
  mode: 'stepped' | 'smooth'
  loop: boolean
}

const DEFAULT_SETTINGS: CameraAnimationSettings = {
  duration: 30,
  viewpointTypes: {
    corner: true,
    edge: true,
    face: true,
  },
  lookAhead: 0,
  easing: 'linear',
  mode: 'smooth',
  loop: true,
}

export function CameraAnimationModal({ isOpen, onClose, onSettingsChange, onPlay, isPlaying = false, showHull = false, onShowHullChange }: CameraAnimationModalProps) {
  const [settings, setSettings] = useState<CameraAnimationSettings>(DEFAULT_SETTINGS)
  const [position, setPosition] = useState({ x: 400, y: 120 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (!isDragging) return
    
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y
      })
    }
    
    const handleMouseUp = () => setIsDragging(false)
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  const handleDragStart = (e: React.MouseEvent) => {
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    }
    setIsDragging(true)
  }

  const updateSetting = <K extends keyof CameraAnimationSettings>(
    key: K,
    value: CameraAnimationSettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    onSettingsChange?.(newSettings)
  }

  const updateViewpointType = (type: 'corner' | 'edge' | 'face', enabled: boolean) => {
    const newViewpointTypes = { ...settings.viewpointTypes, [type]: enabled }
    // Ensure at least one type is selected
    if (!newViewpointTypes.corner && !newViewpointTypes.edge && !newViewpointTypes.face) {
      return
    }
    updateSetting('viewpointTypes', newViewpointTypes)
  }

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS)
    onSettingsChange?.(DEFAULT_SETTINGS)
  }

  if (!isOpen) return null

  return (
    <div style={{ ...styles.modal, left: position.x, top: position.y }}>
      <div style={styles.header} onMouseDown={handleDragStart}>
        <h2 style={styles.title}>Camera Animation</h2>
        <button style={styles.closeButton} onClick={onClose}>×</button>
      </div>

      <div style={styles.content}>
        <Section title="Animation Mode">
          <div style={styles.modeToggle}>
            <button
              style={{
                ...styles.modeButton,
                ...(settings.mode === 'smooth' ? styles.modeButtonActive : {})
              }}
              onClick={() => updateSetting('mode', 'smooth')}
            >
              Smooth
            </button>
            <button
              style={{
                ...styles.modeButton,
                ...(settings.mode === 'stepped' ? styles.modeButtonActive : {})
              }}
              onClick={() => updateSetting('mode', 'stepped')}
            >
              Stepped
            </button>
          </div>
          <div style={styles.modeInfo}>
            {settings.mode === 'smooth' 
              ? 'Camera glides smoothly along a curve through viewpoints'
              : 'Camera jumps between viewpoints at intervals'}
          </div>
        </Section>

        <Section title="Animation Speed">
          <div style={styles.row}>
            <label style={styles.label}>Speed</label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={(() => {
                // Logarithmic scale: slider 0-100 maps to speed 0.01x-100x
                const speed = 600 / settings.duration
                return Math.round(Math.log10(speed * 100) / Math.log10(10000) * 100)
              })()}
              onChange={(e) => {
                // Logarithmic scale: slider 0-100 maps to speed 0.01x-100x
                const sliderVal = parseFloat(e.target.value)
                const speed = Math.pow(10000, sliderVal / 100) / 100
                const duration = Math.round(600 / speed)
                updateSetting('duration', Math.max(6, Math.min(60000, duration)))
              }}
              style={styles.slider}
            />
            <span style={styles.value}>{(600 / settings.duration).toFixed(settings.duration > 600 ? 2 : 1)}x</span>
          </div>
          <div style={{ color: '#666', fontSize: '11px', marginTop: '4px' }}>
            Duration: {settings.duration >= 3600 ? `${(settings.duration / 3600).toFixed(1)} hr` : settings.duration >= 60 ? `${(settings.duration / 60).toFixed(1)} min` : `${settings.duration} sec`}
          </div>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={settings.loop}
              onChange={(e) => updateSetting('loop', e.target.checked)}
              style={styles.checkbox}
            />
            Loop continuously
          </label>
        </Section>

        <Section title="Viewpoint Types">
          <div style={styles.checkboxGroup}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.viewpointTypes.corner}
                onChange={(e) => updateViewpointType('corner', e.target.checked)}
                style={styles.checkbox}
              />
              Corner Views
            </label>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.viewpointTypes.edge}
                onChange={(e) => updateViewpointType('edge', e.target.checked)}
                style={styles.checkbox}
              />
              Edge Views
            </label>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.viewpointTypes.face}
                onChange={(e) => updateViewpointType('face', e.target.checked)}
                style={styles.checkbox}
              />
              Face Views
            </label>
          </div>
          <div style={styles.viewpointInfo}>
            Selected types will be used to generate camera path waypoints
          </div>
          <label style={{ ...styles.checkboxLabel, marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #333' }}>
            <input
              type="checkbox"
              checked={showHull}
              onChange={(e) => onShowHullChange?.(e.target.checked)}
              style={styles.checkbox}
            />
            Show Convex Hull
          </label>
        </Section>

        <Section title="Look Ahead">
          <div style={styles.row}>
            <label style={styles.label}>Look Direction</label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.lookAhead}
              onChange={(e) => updateSetting('lookAhead', parseInt(e.target.value))}
              style={styles.slider}
            />
            <span style={styles.value}>{settings.lookAhead}%</span>
          </div>
          <div style={styles.lookAheadInfo}>
            <span style={styles.infoLabel}>0%</span>
            <span style={styles.infoText}>Look at centroid</span>
            <span style={styles.infoLabel}>100%</span>
            <span style={styles.infoText}>Look along path</span>
          </div>
        </Section>

        <Section title="Easing">
          <div style={styles.row}>
            <label style={styles.label}>Transition Style</label>
            <select
              value={settings.easing}
              onChange={(e) => updateSetting('easing', e.target.value as CameraAnimationSettings['easing'])}
              style={styles.select}
            >
              <option value="linear">Linear</option>
              <option value="easeIn">Ease In</option>
              <option value="easeOut">Ease Out</option>
              <option value="easeInOut">Ease In-Out</option>
            </select>
          </div>
          <div style={styles.easingInfo}>
            Controls how smoothly the camera accelerates and decelerates
          </div>
        </Section>

        <div style={styles.footer}>
          <button
            style={{
              ...styles.playButton,
              ...(isPlaying ? styles.playButtonActive : {})
            }}
            onClick={() => onPlay?.(settings)}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play Animation'}
          </button>
          <button style={styles.resetButton} onClick={handleReset}>
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  modal: {
    position: 'fixed',
    background: '#1a1a1a',
    borderRadius: '12px',
    width: '380px',
    maxHeight: '85vh',
    overflow: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
    zIndex: 1000,
    border: '1px solid #333',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #333',
    cursor: 'grab',
    userSelect: 'none',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#fff',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    color: '#888',
    cursor: 'pointer',
    padding: '0 8px',
  },
  content: {
    padding: '20px 24px',
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    margin: '0 0 14px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    marginBottom: '8px',
  },
  label: {
    flex: '0 0 130px',
    fontSize: '14px',
    color: '#ccc',
  },
  slider: {
    flex: 1,
    height: '6px',
    cursor: 'pointer',
  },
  value: {
    flex: '0 0 50px',
    fontSize: '14px',
    color: '#888',
    textAlign: 'right',
  },
  select: {
    flex: 1,
    padding: '8px 12px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '6px',
    color: '#ccc',
    fontSize: '14px',
    cursor: 'pointer',
  },
  checkboxGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '14px',
    color: '#ccc',
    cursor: 'pointer',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  viewpointInfo: {
    marginTop: '12px',
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
  },
  modeToggle: {
    display: 'flex',
    gap: '8px',
    marginBottom: '10px',
  },
  modeButton: {
    flex: 1,
    padding: '10px 16px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '6px',
    color: '#888',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  modeButtonActive: {
    background: '#2563eb',
    borderColor: '#2563eb',
    color: '#fff',
  },
  modeInfo: {
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
  },
  lookAheadInfo: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto 1fr',
    gap: '6px 12px',
    marginTop: '10px',
    fontSize: '12px',
  },
  infoLabel: {
    color: '#4a9eff',
    fontWeight: 600,
  },
  infoText: {
    color: '#666',
  },
  easingInfo: {
    marginTop: '10px',
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
  },
  footer: {
    marginTop: '24px',
    paddingTop: '18px',
    borderTop: '1px solid #333',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  playButton: {
    width: '100%',
    padding: '14px',
    background: '#2563eb',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  playButtonActive: {
    background: '#1d4ed8',
    cursor: 'default',
  },
  resetButton: {
    width: '100%',
    padding: '12px',
    background: '#333',
    border: '1px solid #555',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer',
  },
}

export default CameraAnimationModal
