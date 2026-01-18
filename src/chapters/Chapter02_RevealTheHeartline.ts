import * as THREE from 'three'
import { Chapter, ChapterContext } from '../engine/ChapterManager'

export type RevealMode = 'fade' | 'collapse'

export interface Chapter02Config {
  mode: RevealMode
}

const DEFAULT_CONFIG: Chapter02Config = {
  mode: 'fade'
}

export class Chapter02_RevealTheHeartline implements Chapter {
  id = 'ch02'
  name = 'Reveal the Heartline'
  
  private ctx: ChapterContext | null = null
  private config: Chapter02Config
  private sculptureObjects: THREE.Object3D[] = []
  private heartlineLine: THREE.Line | null = null
  private originalMaterials: Map<THREE.Object3D, THREE.Material | THREE.Material[]> = new Map()
  private originalPositions: Map<THREE.Object3D, THREE.Vector3> = new Map()

  constructor(config: Partial<Chapter02Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  init(context: ChapterContext): void {
    this.ctx = context
    console.log(`[${this.id}] Initialized with mode: ${this.config.mode}`)
  }

  enter(): void {
    console.log(`[${this.id}] ▶ Enter: ${this.name}`)
    
    if (this.ctx) {
      (this.ctx.scene.background as THREE.Color)?.set(0x0a0a12)
      this.setupSceneReferences()
    }
  }

  private setupSceneReferences(): void {
    if (!this.ctx) return

    this.sculptureObjects = []
    this.originalMaterials.clear()
    this.originalPositions.clear()

    const crossSections = this.ctx.getAllAssets('CROSS_SECTION_')
    for (const section of crossSections) {
      this.sculptureObjects.push(section)
      
      if (section instanceof THREE.Mesh || section instanceof THREE.Line) {
        this.originalMaterials.set(section, section.material)
      }
      this.originalPositions.set(section, section.position.clone())
    }

    const pathObj = this.ctx.getAsset('SCULPTURE_PATH')
    if (pathObj instanceof THREE.Line) {
      this.heartlineLine = pathObj
      this.heartlineLine.visible = false
    }

    console.log(`[${this.id}] Found ${this.sculptureObjects.length} cross-sections`)
  }

  update(localT: number, _globalT: number): void {
    if (!this.ctx) return

    if (this.config.mode === 'fade') {
      this.updateFadeMode(localT)
    } else {
      this.updateCollapseMode(localT)
    }
  }

  private updateFadeMode(t: number): void {
    const sculptureOpacity = 1 - t
    const heartlineOpacity = t

    for (const obj of this.sculptureObjects) {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        const material = obj.material
        if (material instanceof THREE.Material) {
          material.transparent = true
          material.opacity = sculptureOpacity
          material.needsUpdate = true
        }
      }
    }

    if (this.heartlineLine) {
      this.heartlineLine.visible = t > 0.1
      const material = this.heartlineLine.material
      if (material instanceof THREE.Material) {
        material.transparent = true
        material.opacity = heartlineOpacity
        material.needsUpdate = true
      }
    }
  }

  private updateCollapseMode(t: number): void {
    const pathObj = this.ctx?.getAsset('SCULPTURE_PATH')
    if (!pathObj) return

    const pathPosition = pathObj instanceof THREE.Line 
      ? this.getPathPositionAt(pathObj, 0.5) 
      : new THREE.Vector3()

    for (const obj of this.sculptureObjects) {
      const original = this.originalPositions.get(obj)
      if (original) {
        const collapsed = original.clone().lerp(pathPosition, t)
        obj.position.copy(collapsed)

        const scale = 1 - t * 0.9
        obj.scale.setScalar(scale)
      }
    }

    if (this.heartlineLine) {
      this.heartlineLine.visible = t > 0.5
      const material = this.heartlineLine.material
      if (material instanceof THREE.Material) {
        material.transparent = true
        material.opacity = Math.max(0, (t - 0.5) * 2)
        material.needsUpdate = true
      }
    }
  }

  private getPathPositionAt(pathObj: THREE.Line, t: number): THREE.Vector3 {
    const positions = pathObj.geometry.getAttribute('position')
    if (!positions) return new THREE.Vector3()

    const index = Math.floor(t * (positions.count - 1))
    return new THREE.Vector3(
      positions.getX(index),
      positions.getY(index),
      positions.getZ(index)
    )
  }

  exit(): void {
    console.log(`[${this.id}] ◀ Exit: ${this.name}`)
    
    for (const obj of this.sculptureObjects) {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        const original = this.originalMaterials.get(obj)
        if (original) {
          obj.material = original
        }
      }
      
      const originalPos = this.originalPositions.get(obj)
      if (originalPos) {
        obj.position.copy(originalPos)
      }
      obj.scale.setScalar(1)
    }

    for (const obj of this.sculptureObjects) {
      obj.visible = false
    }

    if (this.heartlineLine) {
      this.heartlineLine.visible = true
      const material = this.heartlineLine.material
      if (material instanceof THREE.Material) {
        material.opacity = 1
        material.transparent = false
      }
    }
  }

  setConfig(config: Partial<Chapter02Config>): void {
    this.config = { ...this.config, ...config }
  }
}

export default Chapter02_RevealTheHeartline
