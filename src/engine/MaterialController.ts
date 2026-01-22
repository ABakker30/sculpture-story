import * as THREE from 'three'
import JSZip from 'jszip'

export interface PBRTextures {
  map?: THREE.Texture | null
  normalMap?: THREE.Texture | null
  roughnessMap?: THREE.Texture | null
  metalnessMap?: THREE.Texture | null
  aoMap?: THREE.Texture | null
  displacementMap?: THREE.Texture | null
}

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
  color: '#c8c8c8',
  metalness: 1,
  roughness: 0.07,
  clearcoat: 0.5,
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
    metalness: 1,
    roughness: 0.07,
    clearcoat: 0.5,
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

  async loadPBRFromZip(zipUrl: string): Promise<void> {
    console.info(`[MaterialController] Loading PBR from: ${zipUrl}`)
    
    try {
      const response = await fetch(zipUrl)
      if (!response.ok) throw new Error(`Failed to fetch ${zipUrl}`)
      
      const arrayBuffer = await response.arrayBuffer()
      const zip = await JSZip.loadAsync(arrayBuffer)
      
      const textureLoader = new THREE.TextureLoader()
      const textures: PBRTextures = {}
      
      // Map common PBR texture name patterns to material properties
      // Order matters - more specific patterns first to avoid false matches
      const texturePatterns: Array<{ patterns: string[], key: keyof PBRTextures, encoding?: THREE.ColorSpace }> = [
        { patterns: ['_color_', '_color.', 'basecolor', 'base_color', 'diffuse', 'albedo', '_col_', '_col.'], key: 'map', encoding: THREE.SRGBColorSpace },
        { patterns: ['_normal', '_nrm', 'normalgl', 'normaldx', '_nor_', '_nor.'], key: 'normalMap', encoding: THREE.LinearSRGBColorSpace },
        { patterns: ['_roughness', '_rough', '_rgh'], key: 'roughnessMap', encoding: THREE.LinearSRGBColorSpace },
        { patterns: ['_metallic', '_metalness', '_metal', '_mtl'], key: 'metalnessMap', encoding: THREE.LinearSRGBColorSpace },
        { patterns: ['_ao_', '_ao.', '_ambientocclusion', '_occlusion'], key: 'aoMap', encoding: THREE.LinearSRGBColorSpace },
        { patterns: ['_disp_', '_disp.', '_displacement', '_height'], key: 'displacementMap', encoding: THREE.LinearSRGBColorSpace },
      ]
      
      // Process each file in the zip
      const files = Object.keys(zip.files)
      console.info(`[MaterialController] Found ${files.length} files in zip:`, files)
      
      for (const filename of files) {
        const file = zip.files[filename]
        if (file.dir) continue
        
        const lowerName = filename.toLowerCase()
        if (!lowerName.endsWith('.jpg') && !lowerName.endsWith('.jpeg') && !lowerName.endsWith('.png') && !lowerName.endsWith('.tif') && !lowerName.endsWith('.tiff')) {
          continue
        }
        
        // Find which texture type this file matches
        let matched = false
        for (const { patterns, key, encoding } of texturePatterns) {
          const matches = patterns.some(p => lowerName.includes(p))
          if (matches && !textures[key]) {
            matched = true
            try {
              const blob = await file.async('blob')
              const url = URL.createObjectURL(blob)
              const texture = await new Promise<THREE.Texture>((resolve, reject) => {
                textureLoader.load(url, resolve, undefined, reject)
              })
              texture.colorSpace = encoding || THREE.LinearSRGBColorSpace
              texture.wrapS = THREE.RepeatWrapping
              texture.wrapT = THREE.RepeatWrapping
              textures[key] = texture
              console.info(`[MaterialController] Loaded ${key} from ${filename}`)
            } catch (err) {
              console.warn(`[MaterialController] Failed to load ${filename}:`, err)
            }
            break
          }
        }
        if (!matched) {
          console.info(`[MaterialController] Unmatched texture file: ${filename}`)
        }
      }
      
      // Apply textures to material
      this.applyPBRTextures(textures)
      console.info('[MaterialController] PBR textures applied')
      
    } catch (error) {
      console.error('[MaterialController] Failed to load PBR zip:', error)
      throw error
    }
  }

  applyPBRTextures(textures: PBRTextures): void {
    // Clear existing textures
    this.clearPBRTextures()
    
    if (textures.map) {
      this.material.map = textures.map
      this.material.color.set('#ffffff') // Use white base color when texture is present
    }
    if (textures.normalMap) {
      this.material.normalMap = textures.normalMap
      this.material.normalScale = new THREE.Vector2(1, 1)
    }
    if (textures.roughnessMap) {
      this.material.roughnessMap = textures.roughnessMap
      this.material.roughness = 1.0 // Let the map control roughness
    }
    if (textures.metalnessMap) {
      this.material.metalnessMap = textures.metalnessMap
      this.material.metalness = 1.0 // Let the map control metalness
    }
    if (textures.aoMap) {
      this.material.aoMap = textures.aoMap
      this.material.aoMapIntensity = 1.0
    }
    if (textures.displacementMap) {
      this.material.displacementMap = textures.displacementMap
      this.material.displacementScale = 0.1
    }
    
    this.material.needsUpdate = true
  }

  clearPBRTextures(): void {
    if (this.material.map) { this.material.map.dispose(); this.material.map = null }
    if (this.material.normalMap) { this.material.normalMap.dispose(); this.material.normalMap = null }
    if (this.material.roughnessMap) { this.material.roughnessMap.dispose(); this.material.roughnessMap = null }
    if (this.material.metalnessMap) { this.material.metalnessMap.dispose(); this.material.metalnessMap = null }
    if (this.material.aoMap) { this.material.aoMap.dispose(); this.material.aoMap = null }
    if (this.material.displacementMap) { this.material.displacementMap.dispose(); this.material.displacementMap = null }
    
    this.material.needsUpdate = true
  }

  hasPBRTextures(): boolean {
    return !!(this.material.map || this.material.normalMap || this.material.roughnessMap || 
              this.material.metalnessMap || this.material.aoMap || this.material.displacementMap)
  }

  getActiveTextures(): string[] {
    const active: string[] = []
    if (this.material.map) active.push('Color')
    if (this.material.normalMap) active.push('Normal')
    if (this.material.roughnessMap) active.push('Roughness')
    if (this.material.metalnessMap) active.push('Metalness')
    if (this.material.aoMap) active.push('AO')
    if (this.material.displacementMap) active.push('Displacement')
    return active
  }
}

export const materialController = new MaterialController()
export default materialController
