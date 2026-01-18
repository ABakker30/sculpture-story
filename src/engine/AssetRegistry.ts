import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const REQUIRED_NAMES = ['SCULPTURE_PATH']
const CROSS_SECTION_PREFIX = 'CROSS_SECTION_'

export interface AssetRegistryState {
  loaded: boolean
  usePlaceholder: boolean
  nodes: Map<string, THREE.Object3D>
}

class AssetRegistry {
  private nodes: Map<string, THREE.Object3D> = new Map()
  private loader: GLTFLoader = new GLTFLoader()
  public loaded: boolean = false
  public usePlaceholder: boolean = false

  async load(url: string): Promise<boolean> {
    try {
      const gltf = await this.loader.loadAsync(url)
      this.indexNodes(gltf.scene)
      this.validate()
      this.loaded = true
      this.usePlaceholder = false
      return true
    } catch (error) {
      console.warn(`[AssetRegistry] Failed to load GLB from ${url}:`, error)
      console.info('[AssetRegistry] Switching to placeholder mode')
      this.usePlaceholder = true
      this.loaded = true
      return false
    }
  }

  private indexNodes(scene: THREE.Object3D): void {
    scene.traverse((node) => {
      if (node.name) {
        this.nodes.set(node.name, node)
      }
    })
    console.info(`[AssetRegistry] Indexed ${this.nodes.size} nodes`)
  }

  private validate(): void {
    const missing: string[] = []

    for (const name of REQUIRED_NAMES) {
      if (!this.has(name)) {
        missing.push(name)
      }
    }

    const crossSections = this.getAll(CROSS_SECTION_PREFIX)
    if (crossSections.length === 0) {
      missing.push(`${CROSS_SECTION_PREFIX}0001+`)
    }

    if (missing.length > 0) {
      console.warn('[AssetRegistry] Missing required names:', missing)
    } else {
      console.info('[AssetRegistry] All required names present')
      console.info(`[AssetRegistry] Found ${crossSections.length} cross-sections`)
    }
  }

  get(name: string): THREE.Object3D | undefined {
    return this.nodes.get(name)
  }

  getAll(prefix: string): THREE.Object3D[] {
    const results: THREE.Object3D[] = []
    const sortedKeys = Array.from(this.nodes.keys())
      .filter(key => key.startsWith(prefix))
      .sort()
    
    for (const key of sortedKeys) {
      const node = this.nodes.get(key)
      if (node) results.push(node)
    }
    return results
  }

  has(name: string): boolean {
    return this.nodes.has(name)
  }

  clear(): void {
    this.nodes.clear()
    this.loaded = false
    this.usePlaceholder = false
  }

  getState(): AssetRegistryState {
    return {
      loaded: this.loaded,
      usePlaceholder: this.usePlaceholder,
      nodes: new Map(this.nodes)
    }
  }
}

export const assetRegistry = new AssetRegistry()
export default assetRegistry
