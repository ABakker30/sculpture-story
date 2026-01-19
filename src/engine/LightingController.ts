import * as THREE from 'three'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'

export interface HDREnvironment {
  name: string
  url: string
}

export interface LightingConfig {
  environmentIntensity: number
  showBackground: boolean
  ambientIntensity: number
  keyLightIntensity: number
  keyLightAzimuth: number
  keyLightElevation: number
  fillLightIntensity: number
  rimLightEnabled: boolean
  rimLightIntensity: number
}

const DEFAULT_CONFIG: LightingConfig = {
  environmentIntensity: 0.5,
  showBackground: false,
  ambientIntensity: 0.2,
  keyLightIntensity: 1.0,
  keyLightAzimuth: 45,
  keyLightElevation: 45,
  fillLightIntensity: 0.3,
  rimLightEnabled: true,
  rimLightIntensity: 0.5,
}

const BUILT_IN_ENVIRONMENTS: HDREnvironment[] = [
  { name: 'Default (Procedural)', url: '' },
  { name: 'Studio', url: '/HDRI/Studio.hdr' },
  { name: 'Outdoor', url: '/HDRI/Outdoor.hdr' },
]

class LightingController {
  private config: LightingConfig
  private scene: THREE.Scene | null = null
  private pmremGenerator: THREE.PMREMGenerator | null = null
  private currentEnvMap: THREE.Texture | null = null
  
  private keyLight: THREE.DirectionalLight | null = null
  private fillLight: THREE.DirectionalLight | null = null
  private rimLight: THREE.DirectionalLight | null = null
  private ambientLight: THREE.AmbientLight | null = null

  private environments: HDREnvironment[] = [...BUILT_IN_ENVIRONMENTS]
  private currentEnvironmentIndex: number = 0

  constructor(config: Partial<LightingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  initialize(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    this.scene = scene
    this.pmremGenerator = new THREE.PMREMGenerator(renderer)
    this.pmremGenerator.compileEquirectangularShader()

    this.setupLights()
    this.createFallbackEnvironment()

    console.info('[LightingController] Initialized with fallback environment')
  }

  private setupLights(): void {
    if (!this.scene) return

    this.keyLight = new THREE.DirectionalLight(0xffffff, this.config.keyLightIntensity)
    this.keyLight.name = 'KEY_LIGHT'
    this.keyLight.castShadow = true
    this.keyLight.shadow.mapSize.width = 2048
    this.keyLight.shadow.mapSize.height = 2048
    this.updateKeyLightPosition()
    this.scene.add(this.keyLight)

    this.fillLight = new THREE.DirectionalLight(0x8888ff, this.config.fillLightIntensity)
    this.fillLight.name = 'FILL_LIGHT'
    this.fillLight.position.set(-10, 5, -5)
    this.scene.add(this.fillLight)

    this.rimLight = new THREE.DirectionalLight(0xffffee, this.config.rimLightIntensity)
    this.rimLight.name = 'RIM_LIGHT'
    this.rimLight.position.set(0, -5, -15)
    this.rimLight.visible = this.config.rimLightEnabled
    this.scene.add(this.rimLight)

    this.ambientLight = new THREE.AmbientLight(0x404040, this.config.ambientIntensity)
    this.ambientLight.name = 'AMBIENT_LIGHT'
    this.scene.add(this.ambientLight)

    console.info('[LightingController] Lights set up: key, fill, rim, ambient')
  }

  private updateKeyLightPosition(): void {
    if (!this.keyLight) return

    const azimuthRad = THREE.MathUtils.degToRad(this.config.keyLightAzimuth)
    const elevationRad = THREE.MathUtils.degToRad(this.config.keyLightElevation)
    const distance = 20

    const x = distance * Math.cos(elevationRad) * Math.sin(azimuthRad)
    const y = distance * Math.sin(elevationRad)
    const z = distance * Math.cos(elevationRad) * Math.cos(azimuthRad)

    this.keyLight.position.set(x, y, z)
  }

  private createFallbackEnvironment(): void {
    if (!this.scene || !this.pmremGenerator) return

    const envScene = new THREE.Scene()
    envScene.background = new THREE.Color(0x222233)

    const light1 = new THREE.DirectionalLight(0xffffff, 1)
    light1.position.set(5, 5, 5)
    envScene.add(light1)

    const light2 = new THREE.DirectionalLight(0x4488ff, 0.5)
    light2.position.set(-5, 3, -5)
    envScene.add(light2)

    const renderTarget = this.pmremGenerator.fromScene(envScene)
    this.currentEnvMap = renderTarget.texture

    this.scene.environment = this.currentEnvMap
    if (this.config.showBackground) {
      this.scene.background = this.currentEnvMap
    }
  }

  async loadEnvironment(index: number): Promise<void> {
    if (index < 0 || index >= this.environments.length) {
      console.warn(`[LightingController] Invalid environment index: ${index}`)
      return
    }

    const env = this.environments[index]
    
    if (!env.url) {
      console.info(`[LightingController] Using procedural environment: ${env.name}`)
      this.createFallbackEnvironment()
      this.currentEnvironmentIndex = index
      return
    }

    console.info(`[LightingController] Loading HDR environment: ${env.name}`)

    try {
      const loader = new RGBELoader()
      const texture = await loader.loadAsync(env.url)

      if (this.pmremGenerator && this.scene) {
        const envMap = this.pmremGenerator.fromEquirectangular(texture).texture
        texture.dispose()

        if (this.currentEnvMap) {
          this.currentEnvMap.dispose()
        }

        this.currentEnvMap = envMap
        this.scene.environment = envMap

        if (this.config.showBackground) {
          this.scene.background = envMap
        }

        this.currentEnvironmentIndex = index
        console.info(`[LightingController] Loaded HDR: ${env.name}`)
      }
    } catch (error) {
      console.warn(`[LightingController] Failed to load HDR ${env.name}, using fallback`)
      this.createFallbackEnvironment()
    }
  }

  setEnvironmentIntensity(intensity: number): void {
    this.config.environmentIntensity = intensity
    if (this.scene) {
      this.scene.environmentIntensity = intensity
    }
  }

  setShowBackground(show: boolean): void {
    this.config.showBackground = show
    if (this.scene) {
      this.scene.background = show ? this.currentEnvMap : null
    }
  }

  setKeyLightIntensity(intensity: number): void {
    this.config.keyLightIntensity = intensity
    if (this.keyLight) {
      this.keyLight.intensity = intensity
    }
  }

  setKeyLightDirection(azimuth: number, elevation: number): void {
    this.config.keyLightAzimuth = azimuth
    this.config.keyLightElevation = elevation
    this.updateKeyLightPosition()
  }

  setFillLightIntensity(intensity: number): void {
    this.config.fillLightIntensity = intensity
    if (this.fillLight) {
      this.fillLight.intensity = intensity
    }
  }

  setRimLightEnabled(enabled: boolean): void {
    this.config.rimLightEnabled = enabled
    if (this.rimLight) {
      this.rimLight.visible = enabled
    }
  }

  setRimLightIntensity(intensity: number): void {
    this.config.rimLightIntensity = intensity
    if (this.rimLight) {
      this.rimLight.intensity = intensity
    }
  }

  setAmbientIntensity(intensity: number): void {
    this.config.ambientIntensity = intensity
    if (this.ambientLight) {
      this.ambientLight.intensity = intensity
    }
  }

  getConfig(): LightingConfig {
    return { ...this.config }
  }

  getEnvironments(): HDREnvironment[] {
    return [...this.environments]
  }

  getCurrentEnvironmentIndex(): number {
    return this.currentEnvironmentIndex
  }

  addEnvironment(env: HDREnvironment): void {
    this.environments.push(env)
  }

  dispose(): void {
    if (this.currentEnvMap) {
      this.currentEnvMap.dispose()
      this.currentEnvMap = null
    }
    if (this.pmremGenerator) {
      this.pmremGenerator.dispose()
      this.pmremGenerator = null
    }
    if (this.scene) {
      if (this.keyLight) this.scene.remove(this.keyLight)
      if (this.fillLight) this.scene.remove(this.fillLight)
      if (this.rimLight) this.scene.remove(this.rimLight)
      if (this.ambientLight) this.scene.remove(this.ambientLight)
    }
    this.keyLight = null
    this.fillLight = null
    this.rimLight = null
    this.ambientLight = null
    this.scene = null
  }
}

export const lightingController = new LightingController()
export default lightingController
