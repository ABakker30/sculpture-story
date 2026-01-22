import { useState, useEffect, useRef } from 'react'
import lightingController, { LightingConfig, HDREnvironment } from '../engine/LightingController'
import materialController, { MaterialConfig } from '../engine/MaterialController'

type TabType = 'camera' | 'lighting' | 'material'

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

const DEFAULT_CAMERA_SETTINGS: CameraAnimationSettings = {
  duration: 30,
  viewpointTypes: { corner: true, edge: true, face: true },
  lookAhead: 0,
  easing: 'linear',
  mode: 'smooth',
  loop: true,
}

interface PBRFile {
  name: string
  path: string
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onCameraSettingsChange?: (settings: CameraAnimationSettings) => void
  onCameraPlay?: (settings: CameraAnimationSettings) => void
  isCameraPlaying?: boolean
  showHull?: boolean
  onShowHullChange?: (show: boolean) => void
}

export function SettingsModal({
  isOpen,
  onClose,
  onCameraSettingsChange,
  onCameraPlay,
  isCameraPlaying = false,
  showHull = false,
  onShowHullChange,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('camera')
  const [position, setPosition] = useState({ x: 20, y: 60 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  // Camera settings
  const [cameraSettings, setCameraSettings] = useState<CameraAnimationSettings>(DEFAULT_CAMERA_SETTINGS)

  // Lighting settings
  const [lightingConfig, setLightingConfig] = useState<LightingConfig>(lightingController.getConfig())
  const [environments, setEnvironments] = useState<HDREnvironment[]>([])
  const [currentEnvIndex, setCurrentEnvIndex] = useState(0)

  // Material settings
  const [materialConfig, setMaterialConfig] = useState<MaterialConfig>(materialController.getConfig())
  const [materialPresets] = useState<string[]>(materialController.getPresetNames())
  const [pbrFiles, setPbrFiles] = useState<PBRFile[]>([])
  const [loadingPBR, setLoadingPBR] = useState(false)
  const [activePBR, setActivePBR] = useState<string | null>(null)
  const [materialTab, setMaterialTab] = useState<'properties' | 'pbr'>('properties')

  useEffect(() => {
    if (isOpen) {
      setEnvironments(lightingController.getEnvironments())
      setCurrentEnvIndex(lightingController.getCurrentEnvironmentIndex())
      setMaterialConfig(materialController.getConfig())
      fetchPBRFiles()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y })
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
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y }
    setIsDragging(true)
  }

  // Camera handlers
  const updateCameraSetting = <K extends keyof CameraAnimationSettings>(key: K, value: CameraAnimationSettings[K]) => {
    console.log(`[Settings] Camera.${key} = ${JSON.stringify(value)}`)
    const newSettings = { ...cameraSettings, [key]: value }
    setCameraSettings(newSettings)
    onCameraSettingsChange?.(newSettings)
  }

  const updateViewpointType = (type: 'corner' | 'edge' | 'face', enabled: boolean) => {
    const newTypes = { ...cameraSettings.viewpointTypes, [type]: enabled }
    if (!newTypes.corner && !newTypes.edge && !newTypes.face) return
    updateCameraSetting('viewpointTypes', newTypes)
  }

  // Lighting handlers
  const handleLightingChange = (key: keyof LightingConfig, value: number | boolean) => {
    console.log(`[Settings] Lighting.${key} = ${value}`)
    const newConfig = { ...lightingConfig, [key]: value }
    setLightingConfig(newConfig)
    switch (key) {
      case 'environmentIntensity': lightingController.setEnvironmentIntensity(value as number); break
      case 'showBackground': lightingController.setShowBackground(value as boolean); break
      case 'ambientIntensity': lightingController.setAmbientIntensity(value as number); break
      case 'keyLightIntensity': lightingController.setKeyLightIntensity(value as number); break
      case 'keyLightAzimuth': lightingController.setKeyLightDirection(value as number, lightingConfig.keyLightElevation); break
      case 'keyLightElevation': lightingController.setKeyLightDirection(lightingConfig.keyLightAzimuth, value as number); break
      case 'fillLightIntensity': lightingController.setFillLightIntensity(value as number); break
      case 'rimLightEnabled': lightingController.setRimLightEnabled(value as boolean); break
      case 'rimLightIntensity': lightingController.setRimLightIntensity(value as number); break
    }
  }

  const handleEnvironmentChange = async (index: number) => {
    setCurrentEnvIndex(index)
    await lightingController.loadEnvironment(index)
  }

  // Material handlers
  const handleMaterialChange = (key: keyof MaterialConfig, value: number | string) => {
    console.log(`[Settings] Material.${key} = ${value}`)
    const newConfig = { ...materialConfig, [key]: value }
    setMaterialConfig(newConfig)
    switch (key) {
      case 'color': materialController.setColor(value as string); break
      case 'metalness': materialController.setMetalness(value as number); break
      case 'roughness': materialController.setRoughness(value as number); break
      case 'clearcoat': materialController.setClearcoat(value as number); break
      case 'clearcoatRoughness': materialController.setClearcoatRoughness(value as number); break
      case 'transmission': materialController.setTransmission(value as number); break
      case 'ior': materialController.setIOR(value as number); break
      case 'thickness': materialController.setThickness(value as number); break
    }
  }

  const handlePresetChange = (preset: string) => {
    materialController.applyPreset(preset)
    setMaterialConfig(materialController.getConfig())
  }

  const fetchPBRFiles = async () => {
    const getPath = (filename: string) => `/PBR/${filename}`
    try {
      const response = await fetch('/PBR/manifest.json')
      if (response.ok) {
        const files: string[] = await response.json()
        setPbrFiles(files.map(f => ({ name: f.replace('.zip', ''), path: getPath(f) })))
      }
    } catch {
      const knownFiles = ['FabricTarpPlastic001.zip', 'MarbleCarraraHoned001.zip', 'MetalMachiningRadial001.zip']
      setPbrFiles(knownFiles.map(f => ({ name: f.replace('.zip', ''), path: getPath(f) })))
    }
  }

  const handleLoadPBR = async (pbrFile: PBRFile) => {
    setLoadingPBR(true)
    try {
      await materialController.loadPBRFromZip(pbrFile.path)
      setActivePBR(pbrFile.name)
      setMaterialConfig(materialController.getConfig())
    } catch (error) {
      console.error('Failed to load PBR:', error)
    } finally {
      setLoadingPBR(false)
    }
  }

  const handleClearPBR = () => {
    materialController.clearPBRTextures()
    setActivePBR(null)
    setMaterialConfig(materialController.getConfig())
  }

  if (!isOpen) return null

  return (
    <div style={{ ...styles.modal, left: position.x, top: position.y }}>
      <div style={styles.header} onMouseDown={handleDragStart}>
        <span style={styles.title}>Settings</span>
        <button style={styles.closeBtn} onClick={onClose}>×</button>
      </div>

      <div style={styles.tabs}>
        <button style={{ ...styles.tab, ...(activeTab === 'camera' ? styles.tabActive : {}) }} onClick={() => setActiveTab('camera')}>🎬</button>
        <button style={{ ...styles.tab, ...(activeTab === 'lighting' ? styles.tabActive : {}) }} onClick={() => setActiveTab('lighting')}>💡</button>
        <button style={{ ...styles.tab, ...(activeTab === 'material' ? styles.tabActive : {}) }} onClick={() => setActiveTab('material')}>🎨</button>
      </div>

      <div style={styles.content}>
        {activeTab === 'camera' && (
          <div style={styles.section}>
            <div style={styles.row}>
              <button style={{ ...styles.playBtn, background: isCameraPlaying ? '#e74c3c' : '#27ae60' }} onClick={() => onCameraPlay?.(cameraSettings)}>
                {isCameraPlaying ? '⏹ Stop' : '▶ Play'}
              </button>
            </div>
            <label style={styles.label}>Mode</label>
            <div style={styles.btnGroup}>
              <button style={{ ...styles.optBtn, ...(cameraSettings.mode === 'smooth' ? styles.optBtnActive : {}) }} onClick={() => updateCameraSetting('mode', 'smooth')}>Smooth</button>
              <button style={{ ...styles.optBtn, ...(cameraSettings.mode === 'stepped' ? styles.optBtnActive : {}) }} onClick={() => updateCameraSetting('mode', 'stepped')}>Stepped</button>
            </div>
            <label style={styles.label}>Speed</label>
            <input
              type="range" min={0} max={100} step={1}
              value={Math.round(Math.log10(600 / cameraSettings.duration * 100) / Math.log10(10000) * 100)}
              onChange={(e) => {
                const speed = Math.pow(10000, parseFloat(e.target.value) / 100) / 100
                updateCameraSetting('duration', Math.max(6, Math.min(60000, Math.round(600 / speed))))
              }}
              style={styles.slider}
            />
            <div style={styles.hint}>{(600 / cameraSettings.duration).toFixed(cameraSettings.duration > 600 ? 2 : 1)}x ({cameraSettings.duration >= 60 ? `${(cameraSettings.duration / 60).toFixed(1)}m` : `${cameraSettings.duration}s`})</div>
            <label style={styles.label}>Easing</label>
            <select value={cameraSettings.easing} onChange={(e) => updateCameraSetting('easing', e.target.value as CameraAnimationSettings['easing'])} style={styles.select}>
              <option value="linear">Linear</option>
              <option value="easeIn">Ease In</option>
              <option value="easeOut">Ease Out</option>
              <option value="easeInOut">Ease In-Out</option>
            </select>
            <label style={styles.checkLabel}><input type="checkbox" checked={cameraSettings.loop} onChange={(e) => updateCameraSetting('loop', e.target.checked)} /> Loop</label>
            <label style={styles.label}>Viewpoints</label>
            <div style={styles.checkGroup}>
              <label style={styles.checkLabel}><input type="checkbox" checked={cameraSettings.viewpointTypes.corner} onChange={(e) => updateViewpointType('corner', e.target.checked)} /> Corner</label>
              <label style={styles.checkLabel}><input type="checkbox" checked={cameraSettings.viewpointTypes.edge} onChange={(e) => updateViewpointType('edge', e.target.checked)} /> Edge</label>
              <label style={styles.checkLabel}><input type="checkbox" checked={cameraSettings.viewpointTypes.face} onChange={(e) => updateViewpointType('face', e.target.checked)} /> Face</label>
            </div>
            <label style={styles.checkLabel}><input type="checkbox" checked={showHull} onChange={(e) => onShowHullChange?.(e.target.checked)} /> Show Hull</label>
          </div>
        )}

        {activeTab === 'lighting' && (
          <div style={styles.section}>
            <label style={styles.label}>Environment</label>
            <select value={currentEnvIndex} onChange={(e) => handleEnvironmentChange(parseInt(e.target.value))} style={styles.select}>
              {environments.map((env, i) => <option key={i} value={i}>{env.name}</option>)}
            </select>
            <label style={styles.checkLabel}><input type="checkbox" checked={lightingConfig.showBackground} onChange={(e) => handleLightingChange('showBackground', e.target.checked)} /> Show Background</label>
            <label style={styles.label}>Env Intensity</label>
            <input type="range" min={0} max={3} step={0.1} value={lightingConfig.environmentIntensity} onChange={(e) => handleLightingChange('environmentIntensity', parseFloat(e.target.value))} style={styles.slider} />
            <label style={styles.label}>Ambient</label>
            <input type="range" min={0} max={2} step={0.1} value={lightingConfig.ambientIntensity} onChange={(e) => handleLightingChange('ambientIntensity', parseFloat(e.target.value))} style={styles.slider} />
            <label style={styles.label}>Key Light</label>
            <input type="range" min={0} max={5} step={0.1} value={lightingConfig.keyLightIntensity} onChange={(e) => handleLightingChange('keyLightIntensity', parseFloat(e.target.value))} style={styles.slider} />
            <label style={styles.label}>Fill Light</label>
            <input type="range" min={0} max={2} step={0.1} value={lightingConfig.fillLightIntensity} onChange={(e) => handleLightingChange('fillLightIntensity', parseFloat(e.target.value))} style={styles.slider} />
            <label style={styles.checkLabel}><input type="checkbox" checked={lightingConfig.rimLightEnabled} onChange={(e) => handleLightingChange('rimLightEnabled', e.target.checked)} /> Rim Light</label>
            {lightingConfig.rimLightEnabled && (
              <input type="range" min={0} max={3} step={0.1} value={lightingConfig.rimLightIntensity} onChange={(e) => handleLightingChange('rimLightIntensity', parseFloat(e.target.value))} style={styles.slider} />
            )}
          </div>
        )}

        {activeTab === 'material' && (
          <div style={styles.section}>
            <div style={styles.subTabs}>
              <button style={{ ...styles.subTab, ...(materialTab === 'properties' ? styles.subTabActive : {}) }} onClick={() => setMaterialTab('properties')}>Props</button>
              <button style={{ ...styles.subTab, ...(materialTab === 'pbr' ? styles.subTabActive : {}) }} onClick={() => setMaterialTab('pbr')}>PBR</button>
            </div>
            {materialTab === 'properties' && (
              <>
                <label style={styles.label}>Preset</label>
                <select onChange={(e) => handlePresetChange(e.target.value)} style={styles.select}>
                  <option value="">Select...</option>
                  {materialPresets.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <label style={styles.label}>Color</label>
                <input type="color" value={materialConfig.color} onChange={(e) => handleMaterialChange('color', e.target.value)} style={styles.colorInput} />
                <label style={styles.label}>Metalness</label>
                <input type="range" min={0} max={1} step={0.01} value={materialConfig.metalness} onChange={(e) => handleMaterialChange('metalness', parseFloat(e.target.value))} style={styles.slider} />
                <label style={styles.label}>Roughness</label>
                <input type="range" min={0} max={1} step={0.01} value={materialConfig.roughness} onChange={(e) => handleMaterialChange('roughness', parseFloat(e.target.value))} style={styles.slider} />
                <label style={styles.label}>Clearcoat</label>
                <input type="range" min={0} max={1} step={0.01} value={materialConfig.clearcoat} onChange={(e) => handleMaterialChange('clearcoat', parseFloat(e.target.value))} style={styles.slider} />
                <label style={styles.label}>Transmission</label>
                <input type="range" min={0} max={1} step={0.01} value={materialConfig.transmission} onChange={(e) => handleMaterialChange('transmission', parseFloat(e.target.value))} style={styles.slider} />
              </>
            )}
            {materialTab === 'pbr' && (
              <>
                {activePBR && (
                  <div style={styles.activePBR}>
                    <span>Active: {activePBR}</span>
                    <button onClick={handleClearPBR} style={styles.clearBtn}>Clear</button>
                  </div>
                )}
                <div style={styles.pbrList}>
                  {pbrFiles.map(f => (
                    <button key={f.name} onClick={() => handleLoadPBR(f)} disabled={loadingPBR} style={{ ...styles.pbrBtn, ...(activePBR === f.name ? styles.pbrBtnActive : {}) }}>
                      {f.name}
                    </button>
                  ))}
                </div>
                {loadingPBR && <div style={styles.hint}>Loading...</div>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  modal: {
    position: 'fixed',
    background: 'rgba(20, 20, 25, 0.95)',
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    color: '#fff',
    width: '260px',
    maxHeight: '80vh',
    overflow: 'hidden',
    zIndex: 1000,
    fontSize: '12px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.1)',
    cursor: 'grab',
  },
  title: { fontWeight: 600, fontSize: '14px' },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#fff',
    fontSize: '18px',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  },
  tab: {
    flex: 1,
    padding: '8px',
    background: 'none',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    fontSize: '16px',
  },
  tabActive: { color: '#fff', background: 'rgba(255,255,255,0.1)' },
  content: {
    padding: '12px',
    overflowY: 'auto',
    maxHeight: 'calc(80vh - 80px)',
  },
  section: { display: 'flex', flexDirection: 'column', gap: '8px' },
  row: { display: 'flex', gap: '8px' },
  label: { color: '#aaa', fontSize: '11px', marginTop: '4px' },
  slider: { width: '100%', accentColor: '#4488ff' },
  select: {
    width: '100%',
    padding: '6px',
    background: '#222',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '12px',
  },
  btnGroup: { display: 'flex', gap: '4px' },
  optBtn: {
    flex: 1,
    padding: '6px',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '4px',
    color: '#aaa',
    cursor: 'pointer',
    fontSize: '11px',
  },
  optBtnActive: { background: '#4488ff', color: '#fff', borderColor: '#4488ff' },
  playBtn: {
    flex: 1,
    padding: '8px',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '12px',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#ccc',
    fontSize: '11px',
  },
  checkGroup: { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  hint: { color: '#888', fontSize: '10px' },
  subTabs: { display: 'flex', gap: '4px', marginBottom: '8px' },
  subTab: {
    flex: 1,
    padding: '4px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    color: '#888',
    cursor: 'pointer',
    fontSize: '11px',
  },
  subTabActive: { background: 'rgba(255,255,255,0.15)', color: '#fff' },
  colorInput: { width: '100%', height: '30px', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  activePBR: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 8px',
    background: 'rgba(68,136,255,0.2)',
    borderRadius: '4px',
    fontSize: '11px',
  },
  clearBtn: {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: '10px',
  },
  pbrList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  pbrBtn: {
    padding: '8px',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '4px',
    color: '#ccc',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '11px',
  },
  pbrBtnActive: { background: 'rgba(68,136,255,0.3)', borderColor: '#4488ff' },
}
