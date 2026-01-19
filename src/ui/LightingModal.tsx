import { useState, useEffect, useRef } from 'react'
import lightingController, { LightingConfig, HDREnvironment } from '../engine/LightingController'

interface LightingModalProps {
  isOpen: boolean
  onClose: () => void
}

export function LightingModal({ isOpen, onClose }: LightingModalProps) {
  const [config, setConfig] = useState<LightingConfig>(lightingController.getConfig())
  const [environments, setEnvironments] = useState<HDREnvironment[]>([])
  const [currentEnvIndex, setCurrentEnvIndex] = useState(0)
  const [position, setPosition] = useState({ x: 20, y: 80 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  useEffect(() => {
    setEnvironments(lightingController.getEnvironments())
    setCurrentEnvIndex(lightingController.getCurrentEnvironmentIndex())
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

  const handleEnvironmentChange = async (index: number) => {
    setCurrentEnvIndex(index)
    await lightingController.loadEnvironment(index)
  }

  const handleConfigChange = (key: keyof LightingConfig, value: number | boolean) => {
    const newConfig = { ...config, [key]: value }
    setConfig(newConfig)

    switch (key) {
      case 'environmentIntensity':
        lightingController.setEnvironmentIntensity(value as number)
        break
      case 'showBackground':
        lightingController.setShowBackground(value as boolean)
        break
      case 'ambientIntensity':
        lightingController.setAmbientIntensity(value as number)
        break
      case 'keyLightIntensity':
        lightingController.setKeyLightIntensity(value as number)
        break
      case 'keyLightAzimuth':
        lightingController.setKeyLightDirection(value as number, config.keyLightElevation)
        break
      case 'keyLightElevation':
        lightingController.setKeyLightDirection(config.keyLightAzimuth, value as number)
        break
      case 'fillLightIntensity':
        lightingController.setFillLightIntensity(value as number)
        break
      case 'rimLightEnabled':
        lightingController.setRimLightEnabled(value as boolean)
        break
      case 'rimLightIntensity':
        lightingController.setRimLightIntensity(value as number)
        break
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
        <h2 style={styles.title}>Lighting Controls</h2>
        <button style={styles.closeButton} onClick={onClose}>×</button>
      </div>

        <div style={styles.content}>
          <Section title="Environment">
            <div style={styles.row}>
              <label>HDR Environment</label>
              <select
                value={currentEnvIndex}
                onChange={(e) => handleEnvironmentChange(parseInt(e.target.value))}
                style={styles.select}
              >
                {environments.map((env, idx) => (
                  <option key={env.name} value={idx}>{env.name}</option>
                ))}
              </select>
            </div>
            <SliderRow
              label="Environment Intensity"
              value={config.environmentIntensity}
              min={0} max={5} step={0.1}
              onChange={(v) => handleConfigChange('environmentIntensity', v)}
            />
            <SliderRow
              label="Ambient Light"
              value={config.ambientIntensity}
              min={0} max={3} step={0.1}
              onChange={(v) => handleConfigChange('ambientIntensity', v)}
            />
            <CheckboxRow
              label="Show Background"
              checked={config.showBackground}
              onChange={(v) => handleConfigChange('showBackground', v)}
            />
          </Section>

          <Section title="Key Light">
            <SliderRow
              label="Intensity"
              value={config.keyLightIntensity}
              min={0} max={10} step={0.1}
              onChange={(v) => handleConfigChange('keyLightIntensity', v)}
            />
            <SliderRow
              label="Azimuth"
              value={config.keyLightAzimuth}
              min={-180} max={180} step={5}
              onChange={(v) => handleConfigChange('keyLightAzimuth', v)}
            />
            <SliderRow
              label="Elevation"
              value={config.keyLightElevation}
              min={0} max={90} step={5}
              onChange={(v) => handleConfigChange('keyLightElevation', v)}
            />
          </Section>

          <Section title="Fill Light">
            <SliderRow
              label="Intensity"
              value={config.fillLightIntensity}
              min={0} max={5} step={0.1}
              onChange={(v) => handleConfigChange('fillLightIntensity', v)}
            />
          </Section>

          <Section title="Rim Light">
            <CheckboxRow
              label="Enabled"
              checked={config.rimLightEnabled}
              onChange={(v) => handleConfigChange('rimLightEnabled', v)}
            />
            <SliderRow
              label="Intensity"
              value={config.rimLightIntensity}
              min={0} max={5} step={0.1}
              onChange={(v) => handleConfigChange('rimLightIntensity', v)}
              disabled={!config.rimLightEnabled}
            />
          </Section>
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

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  disabled?: boolean
}

function SliderRow({ label, value, min, max, step, onChange, disabled }: SliderRowProps) {
  return (
    <div style={{ ...styles.row, opacity: disabled ? 0.5 : 1 }}>
      <label style={styles.label}>{label}</label>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={styles.slider}
        disabled={disabled}
      />
      <span style={styles.value}>{value.toFixed(1)}</span>
    </div>
  )
}

interface CheckboxRowProps {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}

function CheckboxRow({ label, checked, onChange }: CheckboxRowProps) {
  return (
    <div style={styles.row}>
      <label style={styles.label}>{label}</label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={styles.checkbox}
      />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  modal: {
    position: 'fixed',
    background: '#1a1a1a',
    borderRadius: '12px',
    width: '420px',
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
    flex: '0 0 140px',
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
  select: {
    flex: 1,
    padding: '8px 12px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '15px',
  },
  checkbox: {
    width: '20px',
    height: '20px',
    cursor: 'pointer',
  },
}

export default LightingModal
