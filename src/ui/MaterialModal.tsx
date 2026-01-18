import { useState, useEffect, useRef } from 'react'
import materialController, { MaterialConfig } from '../engine/MaterialController'

interface MaterialModalProps {
  isOpen: boolean
  onClose: () => void
}

export function MaterialModal({ isOpen, onClose }: MaterialModalProps) {
  const [config, setConfig] = useState<MaterialConfig>(materialController.getConfig())
  const [presets] = useState<string[]>(materialController.getPresetNames())
  const [position, setPosition] = useState({ x: 400, y: 80 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (isOpen) {
      setConfig(materialController.getConfig())
    }
  }, [isOpen])

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

  if (!isOpen) return null

  const handleDragStart = (e: React.MouseEvent) => {
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y }
    setIsDragging(true)
  }

  const handleConfigChange = (key: keyof MaterialConfig, value: number | string | boolean) => {
    const newConfig = { ...config, [key]: value }
    setConfig(newConfig)

    switch (key) {
      case 'color':
        materialController.setColor(value as string)
        break
      case 'metalness':
        materialController.setMetalness(value as number)
        break
      case 'roughness':
        materialController.setRoughness(value as number)
        break
      case 'clearcoat':
        materialController.setClearcoat(value as number)
        break
      case 'clearcoatRoughness':
        materialController.setClearcoatRoughness(value as number)
        break
      case 'transmission':
        materialController.setTransmission(value as number)
        break
      case 'opacity':
        materialController.setOpacity(value as number)
        break
      case 'ior':
        materialController.setIOR(value as number)
        break
      case 'thickness':
        materialController.setThickness(value as number)
        break
    }
  }

  const handlePresetChange = (presetName: string) => {
    materialController.applyPreset(presetName)
    setConfig(materialController.getConfig())
  }

  const handleReset = () => {
    materialController.reset()
    setConfig(materialController.getConfig())
  }

  const handleSavePreset = () => {
    const name = prompt('Enter preset name:')
    if (name && name.trim()) {
      materialController.savePreset(name.trim())
      alert(`Preset "${name.trim()}" saved! Check console for JSON.`)
    }
  }

  return (
    <div 
      style={{ ...styles.modal, left: position.x, top: position.y }}
    >
      <div 
        style={styles.header}
        onMouseDown={handleDragStart}
      >
        <h2 style={styles.title}>Material Controls</h2>
        <button style={styles.closeButton} onClick={onClose}>×</button>
      </div>

        <div style={styles.content}>
          <Section title="Presets">
            <div style={styles.presetGrid}>
              {presets.map((preset) => (
                <button
                  key={preset}
                  style={styles.presetButton}
                  onClick={() => handlePresetChange(preset)}
                >
                  {formatPresetName(preset)}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Base Properties">
            <div style={styles.row}>
              <label style={styles.label}>Color</label>
              <input
                type="color"
                value={config.color}
                onChange={(e) => handleConfigChange('color', e.target.value)}
                style={styles.colorPicker}
              />
              <span style={styles.colorValue}>{config.color}</span>
            </div>
            <SliderRow
              label="Metalness"
              value={config.metalness}
              min={0} max={1} step={0.01}
              onChange={(v) => handleConfigChange('metalness', v)}
            />
            <SliderRow
              label="Roughness"
              value={config.roughness}
              min={0} max={1} step={0.01}
              onChange={(v) => handleConfigChange('roughness', v)}
            />
          </Section>

          <Section title="Clearcoat">
            <SliderRow
              label="Clearcoat"
              value={config.clearcoat}
              min={0} max={1} step={0.01}
              onChange={(v) => handleConfigChange('clearcoat', v)}
            />
            <SliderRow
              label="Clearcoat Roughness"
              value={config.clearcoatRoughness}
              min={0} max={1} step={0.01}
              onChange={(v) => handleConfigChange('clearcoatRoughness', v)}
            />
          </Section>

          <Section title="Transparency">
            <SliderRow
              label="Transmission"
              value={config.transmission}
              min={0} max={1} step={0.01}
              onChange={(v) => handleConfigChange('transmission', v)}
            />
            <SliderRow
              label="Opacity"
              value={config.opacity}
              min={0} max={1} step={0.01}
              onChange={(v) => handleConfigChange('opacity', v)}
            />
            <SliderRow
              label="IOR"
              value={config.ior}
              min={1} max={2.5} step={0.05}
              onChange={(v) => handleConfigChange('ior', v)}
            />
            <SliderRow
              label="Thickness"
              value={config.thickness}
              min={0} max={2} step={0.1}
              onChange={(v) => handleConfigChange('thickness', v)}
            />
          </Section>

          <div style={styles.footer}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={styles.resetButton} onClick={handleReset}>
                Reset
              </button>
              <button style={{ ...styles.resetButton, background: '#2a6e2a' }} onClick={handleSavePreset}>
                Save Preset
              </button>
            </div>
          </div>
        </div>
    </div>
  )
}

function formatPresetName(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').trim()
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function SliderRow({ label, value, min, max, step, onChange }: SliderRowProps) {
  return (
    <div style={styles.row}>
      <label style={styles.label}>{label}</label>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={styles.slider}
      />
      <span style={styles.value}>{value.toFixed(2)}</span>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  modal: {
    position: 'fixed',
    background: '#1a1a1a',
    borderRadius: '12px',
    width: '440px',
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
    fontSize: '20px',
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
    fontSize: '15px',
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    marginBottom: '12px',
  },
  label: {
    flex: '0 0 150px',
    fontSize: '15px',
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
  colorPicker: {
    width: '44px',
    height: '34px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    padding: 0,
  },
  colorValue: {
    fontSize: '14px',
    color: '#888',
    fontFamily: 'monospace',
  },
  presetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px',
  },
  presetButton: {
    padding: '10px 14px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '6px',
    color: '#ccc',
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  footer: {
    marginTop: '24px',
    paddingTop: '18px',
    borderTop: '1px solid #333',
  },
  resetButton: {
    flex: 1,
    padding: '12px',
    background: '#333',
    border: '1px solid #555',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer',
  },
}

export default MaterialModal
