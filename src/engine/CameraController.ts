import * as THREE from 'three'

export interface CameraConfig {
  minDistance: number
  maxDistance: number
  enableDamping: boolean
  dampingFactor: number
  autoRotate: boolean
  autoRotateSpeed: number
  enablePan: boolean
  maxPolarAngle: number
  minPolarAngle: number
}

const DEFAULT_CONFIG: CameraConfig = {
  minDistance: 5,
  maxDistance: 100,
  enableDamping: true,
  dampingFactor: 0.05,
  autoRotate: false,
  autoRotateSpeed: 0.5,
  enablePan: true,
  maxPolarAngle: Math.PI * 0.85,
  minPolarAngle: Math.PI * 0.1,
}

class CameraController {
  private config: CameraConfig
  private camera: THREE.PerspectiveCamera | null = null
  private targetCenter: THREE.Vector3 = new THREE.Vector3()

  constructor(config: Partial<CameraConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  getConfig(): CameraConfig {
    return { ...this.config }
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera
  }

  centerOnBounds(boundingBox: THREE.Box3): void {
    if (!this.camera) return

    const center = new THREE.Vector3()
    boundingBox.getCenter(center)
    this.targetCenter.copy(center)

    const size = new THREE.Vector3()
    boundingBox.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z)

    const fov = this.camera.fov * (Math.PI / 180)
    const distance = maxDim / (2 * Math.tan(fov / 2)) * 1.5

    this.config.minDistance = distance * 0.3
    this.config.maxDistance = distance * 5

    const offset = new THREE.Vector3(1, 0.5, 1).normalize().multiplyScalar(distance)
    this.camera.position.copy(center).add(offset)
    this.camera.lookAt(center)

    console.info(`[CameraController] Centered on bounds, distance: ${distance.toFixed(2)}`)
  }

  getTargetCenter(): THREE.Vector3 {
    return this.targetCenter.clone()
  }

  setAutoRotate(enabled: boolean): void {
    this.config.autoRotate = enabled
  }

  setAutoRotateSpeed(speed: number): void {
    this.config.autoRotateSpeed = speed
  }

  updateConfig(config: Partial<CameraConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

export const cameraController = new CameraController()
export default cameraController
