import * as THREE from 'three'
import { Chapter, ChapterContext } from '../engine/ChapterManager'
import { extractVertices } from '../engine/GeometryDerivation'

interface CameraPosition {
  position: THREE.Vector3
  target: THREE.Vector3
}

export class Chapter01_ExploreTheSculpture implements Chapter {
  id = 'ch01'
  name = 'Explore the Sculpture'
  
  private ctx: ChapterContext | null = null
  private cameraPositions: CameraPosition[] = []
  private originalCameraPosition = new THREE.Vector3()
  private currentPositionIndex = 0
  private isManualMode = true

  init(context: ChapterContext): void {
    this.ctx = context
    console.log(`[${this.id}] Initialized`)
  }

  enter(): void {
    console.log(`[${this.id}] ▶ Enter: ${this.name}`)
    
    if (this.ctx) {
      (this.ctx.scene.background as THREE.Color)?.set(0x0a0a0a)
      this.originalCameraPosition.copy(this.ctx.camera.position)
      this.computeCameraPositions()
    }
  }

  private computeCameraPositions(): void {
    if (!this.ctx) return
    
    this.cameraPositions = []
    
    const pathObj = this.ctx.getAsset('SCULPTURE_PATH')
    if (!pathObj) {
      this.generateFallbackPositions()
      return
    }

    const vertices = extractVertices(pathObj)
    if (vertices.length < 3) {
      this.generateFallbackPositions()
      return
    }

    const center = this.computeCenter(vertices)
    const hull = this.computeConvexHullFaces(vertices)

    for (const vertex of vertices) {
      const direction = new THREE.Vector3().subVectors(center, vertex).normalize()
      const distance = vertex.distanceTo(center) * 2.5
      const position = vertex.clone().add(direction.multiplyScalar(-distance))
      
      this.cameraPositions.push({
        position,
        target: center.clone()
      })
    }

    for (const face of hull) {
      const midpoint = face.midpoint.clone()
      const normal = face.normal.clone()
      const distance = midpoint.distanceTo(center) * 3
      const position = midpoint.clone().add(normal.multiplyScalar(distance))
      
      this.cameraPositions.push({
        position,
        target: center.clone()
      })
    }

    console.log(`[${this.id}] Generated ${this.cameraPositions.length} camera positions`)
  }

  private generateFallbackPositions(): void {
    const positions = [
      { position: new THREE.Vector3(8, 6, 8), target: new THREE.Vector3(0, 0, 0) },
      { position: new THREE.Vector3(-8, 4, 6), target: new THREE.Vector3(0, 0, 0) },
      { position: new THREE.Vector3(0, 10, 0), target: new THREE.Vector3(0, 0, 0) },
      { position: new THREE.Vector3(6, 2, -8), target: new THREE.Vector3(0, 0, 0) },
    ]
    this.cameraPositions = positions
  }

  private computeCenter(vertices: THREE.Vector3[]): THREE.Vector3 {
    const center = new THREE.Vector3()
    for (const v of vertices) {
      center.add(v)
    }
    return center.divideScalar(vertices.length)
  }

  private computeConvexHullFaces(vertices: THREE.Vector3[]): { midpoint: THREE.Vector3, normal: THREE.Vector3 }[] {
    const faces: { midpoint: THREE.Vector3, normal: THREE.Vector3 }[] = []
    
    for (let i = 0; i < vertices.length - 1; i++) {
      const v1 = vertices[i]
      const v2 = vertices[i + 1]
      const midpoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5)
      
      const edge = new THREE.Vector3().subVectors(v2, v1).normalize()
      const up = new THREE.Vector3(0, 1, 0)
      const normal = new THREE.Vector3().crossVectors(edge, up).normalize()
      
      if (normal.lengthSq() < 0.01) {
        normal.set(1, 0, 0)
      }
      
      faces.push({ midpoint, normal })
    }
    
    return faces
  }

  update(localT: number, _globalT: number): void {
    if (!this.ctx || this.isManualMode || this.cameraPositions.length === 0) return

    const totalPositions = this.cameraPositions.length
    const positionDuration = 1 / totalPositions
    const positionIndex = Math.min(
      Math.floor(localT / positionDuration),
      totalPositions - 1
    )
    const positionT = (localT % positionDuration) / positionDuration

    if (positionIndex !== this.currentPositionIndex) {
      this.currentPositionIndex = positionIndex
    }

    const current = this.cameraPositions[positionIndex]
    const next = this.cameraPositions[(positionIndex + 1) % totalPositions]

    const smoothT = this.easeInOutCubic(positionT)
    
    this.ctx.camera.position.lerpVectors(current.position, next.position, smoothT)
    
    const currentTarget = current.target.clone()
    const nextTarget = next.target.clone()
    const target = currentTarget.lerp(nextTarget, smoothT)
    this.ctx.camera.lookAt(target)
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 
      ? 4 * t * t * t 
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  setManualMode(manual: boolean): void {
    this.isManualMode = manual
  }

  exit(): void {
    console.log(`[${this.id}] ◀ Exit: ${this.name}`)
  }
}

export default Chapter01_ExploreTheSculpture
