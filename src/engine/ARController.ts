import * as THREE from 'three'

export interface ARControllerConfig {
  onSessionStart?: () => void
  onSessionEnd?: () => void
  onError?: (error: Error) => void
}

export class ARController {
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private xrSession: XRSession | null = null
  private xrRefSpace: XRReferenceSpace | null = null
  private config: ARControllerConfig
  
  // AR object (the sculpture group)
  private arObject: THREE.Object3D | null = null
  private arObjectParent: THREE.Object3D | null = null
  
  // Gesture state
  private initialPinchDistance: number = 0
  private initialScale: number = 1
  private initialTouchPositions: Map<number, { x: number; y: number }> = new Map()
  private isPlaced: boolean = false
  private hitTestSource: XRHitTestSource | null = null
  private reticle: THREE.Mesh | null = null
  
  // Store original state for restoration
  private originalParent: THREE.Object3D | null = null
  private originalPosition: THREE.Vector3 = new THREE.Vector3()
  private originalRotation: THREE.Euler = new THREE.Euler()
  private originalScale: THREE.Vector3 = new THREE.Vector3()

  constructor(config: ARControllerConfig = {}) {
    this.config = config
  }

  async isARSupported(): Promise<boolean> {
    if (!navigator.xr) {
      console.warn('[ARController] WebXR not available')
      return false
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar')
      console.info(`[ARController] AR supported: ${supported}`)
      return supported
    } catch (error) {
      console.error('[ARController] Error checking AR support:', error)
      return false
    }
  }

  setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer
  }

  setScene(scene: THREE.Scene): void {
    this.scene = scene
  }

  // Camera is managed by WebXR during AR session

  setARObject(object: THREE.Object3D): void {
    this.arObject = object
    // Store original transform
    this.originalParent = object.parent
    this.originalPosition.copy(object.position)
    this.originalRotation.copy(object.rotation)
    this.originalScale.copy(object.scale)
  }

  async startARSession(): Promise<boolean> {
    if (!this.renderer || !this.scene) {
      console.error('[ARController] Renderer or scene not set')
      this.config.onError?.(new Error('Renderer or scene not set'))
      return false
    }

    if (!navigator.xr) {
      console.error('[ARController] WebXR not available')
      this.config.onError?.(new Error('WebXR not available'))
      return false
    }

    try {
      // Request AR session with hit-test feature
      this.xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body }
      })

      // Enable XR on renderer
      this.renderer.xr.enabled = true
      await this.renderer.xr.setSession(this.xrSession)

      // Get reference space
      this.xrRefSpace = await this.xrSession.requestReferenceSpace('local-floor')

      // Setup hit test for placement
      const viewerSpace = await this.xrSession.requestReferenceSpace('viewer')
      this.hitTestSource = await this.xrSession.requestHitTestSource!({ space: viewerSpace }) ?? null

      // Create placement reticle
      this.createReticle()

      // Setup session end handler
      this.xrSession.addEventListener('end', () => this.onSessionEnd())

      // Setup input handlers for gestures
      this.setupGestureHandlers()

      this.isPlaced = false
      this.config.onSessionStart?.()
      console.info('[ARController] AR session started')
      return true

    } catch (error) {
      console.error('[ARController] Failed to start AR session:', error)
      this.config.onError?.(error as Error)
      return false
    }
  }

  private createReticle(): void {
    const geometry = new THREE.RingGeometry(0.1, 0.12, 32)
    geometry.rotateX(-Math.PI / 2)
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.8, transparent: true })
    this.reticle = new THREE.Mesh(geometry, material)
    this.reticle.visible = false
    this.scene?.add(this.reticle)
  }

  updateHitTest(frame: XRFrame): void {
    if (!this.hitTestSource || !this.xrRefSpace || this.isPlaced) return

    const hitTestResults = frame.getHitTestResults(this.hitTestSource)
    if (hitTestResults.length > 0 && this.reticle) {
      const hit = hitTestResults[0]
      const pose = hit.getPose(this.xrRefSpace)
      if (pose) {
        this.reticle.visible = true
        this.reticle.position.setFromMatrixPosition(new THREE.Matrix4().fromArray(pose.transform.matrix))
      }
    } else if (this.reticle) {
      this.reticle.visible = false
    }
  }

  placeObject(): boolean {
    if (!this.arObject || !this.reticle || !this.reticle.visible) return false

    // Create AR parent for gesture transforms
    this.arObjectParent = new THREE.Group()
    this.arObjectParent.position.copy(this.reticle.position)
    this.scene?.add(this.arObjectParent)

    // Reset object transform and add to AR parent
    this.arObject.position.set(0, 0, 0)
    this.arObject.rotation.set(0, 0, 0)
    this.arObject.scale.set(0.1, 0.1, 0.1) // Start small in AR
    this.arObjectParent.add(this.arObject)

    // Hide reticle
    this.reticle.visible = false
    this.isPlaced = true

    console.info('[ARController] Object placed in AR')
    return true
  }

  private setupGestureHandlers(): void {
    if (!this.xrSession) return

    // Touch events for gesture handling
    document.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false })
    document.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false })
    document.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false })

    // XR select for placement
    this.xrSession.addEventListener('select', () => {
      if (!this.isPlaced) {
        this.placeObject()
      }
    })
  }

  private onTouchStart(event: TouchEvent): void {
    if (!this.isPlaced || !this.arObjectParent) return

    for (let i = 0; i < event.touches.length; i++) {
      const touch = event.touches[i]
      this.initialTouchPositions.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Two finger gesture - store initial pinch distance
    if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX
      const dy = event.touches[0].clientY - event.touches[1].clientY
      this.initialPinchDistance = Math.sqrt(dx * dx + dy * dy)
      this.initialScale = this.arObjectParent.scale.x
    }
  }

  private onTouchMove(event: TouchEvent): void {
    if (!this.isPlaced || !this.arObjectParent) return
    event.preventDefault()

    if (event.touches.length === 1) {
      // Single finger drag - move object
      const touch = event.touches[0]
      const initial = this.initialTouchPositions.get(touch.identifier)
      if (initial) {
        const dx = (touch.clientX - initial.x) * 0.001
        const dz = (touch.clientY - initial.y) * 0.001
        this.arObjectParent.position.x += dx
        this.arObjectParent.position.z += dz
        this.initialTouchPositions.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
      }
    } else if (event.touches.length === 2) {
      // Two finger gesture - pinch to scale, twist to rotate
      const touch0 = event.touches[0]
      const touch1 = event.touches[1]

      // Calculate current pinch distance
      const dx = touch0.clientX - touch1.clientX
      const dy = touch0.clientY - touch1.clientY
      const currentDistance = Math.sqrt(dx * dx + dy * dy)

      // Scale
      if (this.initialPinchDistance > 0) {
        const scaleFactor = currentDistance / this.initialPinchDistance
        const newScale = Math.max(0.01, Math.min(2, this.initialScale * scaleFactor))
        this.arObjectParent.scale.setScalar(newScale)
      }

      // Rotation (calculate angle between touches)
      const initial0 = this.initialTouchPositions.get(touch0.identifier)
      const initial1 = this.initialTouchPositions.get(touch1.identifier)
      if (initial0 && initial1) {
        const initialAngle = Math.atan2(initial1.y - initial0.y, initial1.x - initial0.x)
        const currentAngle = Math.atan2(touch1.clientY - touch0.clientY, touch1.clientX - touch0.clientX)
        const deltaAngle = currentAngle - initialAngle
        this.arObjectParent.rotation.y -= deltaAngle

        // Update stored positions for next frame
        this.initialTouchPositions.set(touch0.identifier, { x: touch0.clientX, y: touch0.clientY })
        this.initialTouchPositions.set(touch1.identifier, { x: touch1.clientX, y: touch1.clientY })
      }
    }
  }

  private onTouchEnd(event: TouchEvent): void {
    // Clear ended touches
    const activeTouchIds = new Set<number>()
    for (let i = 0; i < event.touches.length; i++) {
      activeTouchIds.add(event.touches[i].identifier)
    }
    for (const id of this.initialTouchPositions.keys()) {
      if (!activeTouchIds.has(id)) {
        this.initialTouchPositions.delete(id)
      }
    }

    // Reset pinch tracking if no longer two fingers
    if (event.touches.length < 2) {
      this.initialPinchDistance = 0
    }
  }

  private onSessionEnd(): void {
    console.info('[ARController] AR session ended')
    
    // Restore object to original state
    if (this.arObject && this.originalParent) {
      this.originalParent.add(this.arObject)
      this.arObject.position.copy(this.originalPosition)
      this.arObject.rotation.copy(this.originalRotation)
      this.arObject.scale.copy(this.originalScale)
    }

    // Cleanup AR parent
    if (this.arObjectParent) {
      this.scene?.remove(this.arObjectParent)
      this.arObjectParent = null
    }

    // Cleanup reticle
    if (this.reticle) {
      this.scene?.remove(this.reticle)
      this.reticle.geometry.dispose()
      ;(this.reticle.material as THREE.Material).dispose()
      this.reticle = null
    }

    // Remove event listeners
    document.removeEventListener('touchstart', this.onTouchStart.bind(this))
    document.removeEventListener('touchmove', this.onTouchMove.bind(this))
    document.removeEventListener('touchend', this.onTouchEnd.bind(this))

    // Reset state
    this.xrSession = null
    this.xrRefSpace = null
    this.hitTestSource = null
    this.isPlaced = false
    this.initialTouchPositions.clear()

    if (this.renderer) {
      this.renderer.xr.enabled = false
    }

    this.config.onSessionEnd?.()
  }

  async endARSession(): Promise<void> {
    if (this.xrSession) {
      await this.xrSession.end()
    }
  }

  isInARSession(): boolean {
    return this.xrSession !== null
  }

  isObjectPlaced(): boolean {
    return this.isPlaced
  }
}
