import * as THREE from 'three'

export interface MaterialConfig {
  color: string
  metalness: number
  roughness: number
  clearcoat: number
  clearcoatRoughness: number
  transmission: number
  opacity: number
  transparent: boolean
  ior: number
  thickness: number
}

const DEFAULT_CONFIG: MaterialConfig = {
  color: '#c0c0c0',
  metalness: 0.95,
  roughness: 0.25,
  clearcoat: 0.3,
  clearcoatRoughness: 0.1,
  transmission: 0,
  opacity: 1.0,
  transparent: false,
  ior: 1.5,
  thickness: 0.5,
}

const PRESETS: Record<string, Partial<MaterialConfig>> = {
  stainlessSteel: {
    color: '#c8c8c8',
    metalness: 0.95,
    roughness: 0.2,
    clearcoat: 0.4,
    clearcoatRoughness: 0.1,
    transmission: 0,
    opacity: 1.0,
    transparent: false,
  },
  brushedMetal: {
    color: '#b0b0b0',
    metalness: 0.9,
    roughness: 0.4,
    clearcoat: 0.1,
    clearcoatRoughness: 0.3,
    transmission: 0,
    opacity: 1.0,
    transparent: false,
  },
  chrome: {
    color: '#ffffff',
    metalness: 1.0,
    roughness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    transmission: 0,
    opacity: 1.0,
    transparent: false,
  },
  glass: {
    color: '#ffffff',
    metalness: 0.0,
    roughness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    transmission: 0.95,
    opacity: 0.3,
    transparent: true,
    ior: 1.5,
    thickness: 0.5,
  },
  frostedGlass: {
    color: '#f0f0f0',
    metalness: 0.0,
    roughness: 0.3,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    transmission: 0.8,
    opacity: 0.5,
    transparent: true,
    ior: 1.4,
    thickness: 0.3,
  },
  bronze: {
    color: '#cd7f32',
    metalness: 0.85,
    roughness: 0.35,
    clearcoat: 0.2,
    clearcoatRoughness: 0.2,
    transmission: 0,
    opacity: 1.0,
    transparent: false,
  },
  matte: {
    color: '#808080',
    metalness: 0.0,
    roughness: 0.9,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    transmission: 0,
    opacity: 1.0,
    transparent: false,
  },
  red: {
    color: '#cc2222',
    metalness: 0.85,
    roughness: 0.25,
    clearcoat: 0.5,
    clearcoatRoughness: 0.1,
    transmission: 0,
    opacity: 1.0,
    transparent: false,
  },
}

const customPresets: Record<string, Partial<MaterialConfig>> = {}

class MaterialController {
  private config: MaterialConfig
  private material: THREE.MeshPhysicalMaterial

  constructor(config: Partial<MaterialConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.material = this.createMaterial()
  }

  private createMaterial(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(this.config.color),
      metalness: this.config.metalness,
      roughness: this.config.roughness,
      clearcoat: this.config.clearcoat,
      clearcoatRoughness: this.config.clearcoatRoughness,
      transmission: this.config.transmission,
      opacity: this.config.opacity,
      transparent: this.config.transparent || this.config.transmission > 0,
      ior: this.config.ior,
      thickness: this.config.thickness,
      side: THREE.DoubleSide,
      envMapIntensity: 1.0,
    })
  }

  getMaterial(): THREE.MeshPhysicalMaterial {
    return this.material
  }

  setColor(color: string): void {
    this.config.color = color
    this.material.color.set(color)
    this.material.needsUpdate = true
  }

  setMetalness(value: number): void {
    this.config.metalness = THREE.MathUtils.clamp(value, 0, 1)
    this.material.metalness = this.config.metalness
  }

  setRoughness(value: number): void {
    this.config.roughness = THREE.MathUtils.clamp(value, 0, 1)
    this.material.roughness = this.config.roughness
  }

  setClearcoat(value: number): void {
    this.config.clearcoat = THREE.MathUtils.clamp(value, 0, 1)
    this.material.clearcoat = this.config.clearcoat
  }

  setClearcoatRoughness(value: number): void {
    this.config.clearcoatRoughness = THREE.MathUtils.clamp(value, 0, 1)
    this.material.clearcoatRoughness = this.config.clearcoatRoughness
  }

  setTransmission(value: number): void {
    this.config.transmission = THREE.MathUtils.clamp(value, 0, 1)
    this.material.transmission = this.config.transmission
    this.material.transparent = this.config.transmission > 0 || this.config.opacity < 1
  }

  setOpacity(value: number): void {
    this.config.opacity = THREE.MathUtils.clamp(value, 0, 1)
    this.material.opacity = this.config.opacity
    this.material.transparent = this.config.opacity < 1 || this.config.transmission > 0
  }

  setIOR(value: number): void {
    this.config.ior = THREE.MathUtils.clamp(value, 1, 2.5)
    this.material.ior = this.config.ior
  }

  setThickness(value: number): void {
    this.config.thickness = Math.max(0, value)
    this.material.thickness = this.config.thickness
  }

  applyPreset(presetName: string): void {
    const preset = PRESETS[presetName] || customPresets[presetName]
    if (!preset) {
      console.warn(`[MaterialController] Unknown preset: ${presetName}`)
      return
    }

    this.config = { ...this.config, ...preset }
    this.updateMaterialFromConfig()
    console.info(`[MaterialController] Applied preset: ${presetName}`)
  }

  savePreset(presetName: string): void {
    customPresets[presetName] = { ...this.config }
    console.info(`[MaterialController] Saved preset: ${presetName}`)
    console.info(JSON.stringify(customPresets[presetName], null, 2))
  }

  private updateMaterialFromConfig(): void {
    this.material.color.set(this.config.color)
    this.material.metalness = this.config.metalness
    this.material.roughness = this.config.roughness
    this.material.clearcoat = this.config.clearcoat
    this.material.clearcoatRoughness = this.config.clearcoatRoughness
    this.material.transmission = this.config.transmission
    this.material.opacity = this.config.opacity
    this.material.transparent = this.config.transparent || this.config.transmission > 0 || this.config.opacity < 1
    this.material.ior = this.config.ior
    this.material.thickness = this.config.thickness
    this.material.needsUpdate = true
  }

  getConfig(): MaterialConfig {
    return { ...this.config }
  }

  getPresetNames(): string[] {
    return Object.keys(PRESETS)
  }

  reset(): void {
    this.config = { ...DEFAULT_CONFIG }
    this.updateMaterialFromConfig()
    console.info('[MaterialController] Reset to defaults')
  }

  dispose(): void {
    this.material.dispose()
  }
}

export const materialController = new MaterialController()
export default materialController
