import * as THREE from 'three'

export interface ARControllerConfig {
  onSessionStart?: () => void
  onSessionEnd?: () => void
  onSceneReset?: () => void
  onError?: (error: Error) => void
  onDebug?: (message: string) => void
}

export class ARController {
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private xrSession: XRSession | null = null
  private xrRefSpace: XRReferenceSpace | null = null
  private config: ARControllerConfig
  
  // AR object (the sculpture group)
  private arObject: THREE.Object3D | null = null
  private arObjectParent: THREE.Object3D | null = null
  private arObjectUUIDs: string[] = [] // Track UUIDs of AR objects for cleanup
  
  // Gesture state
  private initialPinchDistance: number = 0
  private initialScale: number = 1
  private initialTouchPositions: Map<number, { x: number; y: number }> = new Map()
  private isPlaced: boolean = false
  private hitTestSource: XRHitTestSource | null = null
  private reticle: THREE.Mesh | null = null
  
  // Store original mesh and its state for restoration (no cloning)
  private originalMesh: THREE.Mesh | null = null
  private originalMeshParent: THREE.Object3D | null = null
  private originalPosition: THREE.Vector3 = new THREE.Vector3()
  private originalRotation: THREE.Euler = new THREE.Euler()
  private originalScale: THREE.Vector3 = new THREE.Vector3()
  private originalVisible: boolean = true

  constructor(config: ARControllerConfig = {}) {
    this.config = config
  }

  private debug(message: string): void {
    console.info(message)
    this.config.onDebug?.(message)
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

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera
  }

  setScene(scene: THREE.Scene): void {
    this.scene = scene
  }

  // Camera is managed by WebXR during AR session

  setARObject(object: THREE.Object3D): void {
    this.arObject = object
    // Store original transform
    this.originalMeshParent = object.parent
    this.originalPosition.copy(object.position)
    this.originalRotation.copy(object.rotation)
    this.originalScale.copy(object.scale)
  }

  async startARSession(): Promise<boolean> {
    // If already in a session, end it first
    if (this.xrSession) {
      console.info('[ARController] Ending existing session before starting new one')
      await this.endARSession()
      return false
    }

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
      // Request AR session - hit-test is optional
      this.xrSession = await navigator.xr.requestSession('immersive-ar', {
        optionalFeatures: ['hit-test', 'dom-overlay', 'local-floor'],
        domOverlay: { root: document.body }
      })

      // Enable XR on renderer
      this.renderer.xr.enabled = true
      
      // Configure renderer for AR passthrough (transparent background)
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.setClearAlpha(0)
      
      await this.renderer.xr.setSession(this.xrSession)

      // Get reference space - try different types as fallback
      const refSpaceTypes: XRReferenceSpaceType[] = ['local-floor', 'local', 'viewer']
      for (const type of refSpaceTypes) {
        try {
          this.xrRefSpace = await this.xrSession.requestReferenceSpace(type)
          console.info(`[ARController] Using reference space: ${type}`)
          break
        } catch {
          console.info(`[ARController] ${type} not supported`)
        }
      }

      if (!this.xrRefSpace) {
        throw new Error('No supported reference space found')
      }

      // Setup hit-test for surface detection
      try {
        const viewerSpace = await this.xrSession.requestReferenceSpace('viewer')
        this.hitTestSource = await this.xrSession.requestHitTestSource!({ space: viewerSpace }) ?? null
        this.debug('Hit-test enabled')
      } catch {
        this.debug('Hit-test not available')
      }
      
      // Create reticle for placement preview
      this.createReticle()
      
      // Hide all meshes initially
      this.scene?.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.name === 'DEBUG_LOFT_MESH') {
          obj.visible = false
        }
      })
      
      // Setup frame loop for hit-test updates
      this.renderer.setAnimationLoop((_, frame) => this.onXRFrame(frame))

      // Setup session end handler
      this.xrSession.addEventListener('end', () => this.onSessionEnd())

      // Setup input handlers for gestures and placement
      this.setupGestureHandlers()
      
      this.isPlaced = false
      this.debug('Tap surface to place')
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

  private onXRFrame(frame: XRFrame | null): void {
    if (!frame || !this.xrSession || !this.scene || !this.camera) return
    
    // Update hit-test if not yet placed
    if (!this.isPlaced) {
      this.updateHitTest(frame)
    }
    
    // Update camera from XR pose
    const pose = frame.getViewerPose(this.xrRefSpace!)
    if (pose) {
      const view = pose.views[0]
      this.camera.matrix.fromArray(view.transform.matrix)
      this.camera.matrix.decompose(this.camera.position, this.camera.quaternion, this.camera.scale)
      this.camera.updateMatrixWorld(true)
    }
    
    // Render the scene
    if (this.renderer && this.camera) {
      this.renderer.render(this.scene, this.camera)
    }
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
    if (!this.scene) {
      this.debug('Cannot place: no scene')
      return false
    }
    
    // If no reticle/surface, place at default position in front
    const placeAtReticle = this.reticle?.visible
    const placePosition = placeAtReticle && this.reticle 
      ? this.reticle.position.clone()
      : new THREE.Vector3(0, -0.3, -0.8) // 0.8m in front, slightly below eye level
    
    this.debug(`Placing at ${placeAtReticle ? 'reticle' : 'default'}`)

    // Find the sculpture mesh - use ORIGINAL, don't clone
    const mesh = this.scene.getObjectByName('DEBUG_LOFT_MESH') as THREE.Mesh | null
    if (!mesh) {
      this.debug('Cannot place: no sculpture')
      return false
    }

    // Store original state for restoration
    this.originalMesh = mesh
    this.originalMeshParent = mesh.parent
    this.originalPosition.copy(mesh.position)
    this.originalRotation.copy(mesh.rotation)
    this.originalScale.copy(mesh.scale)
    this.originalVisible = mesh.visible
    
    // Calculate scale to fit in 75cm
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox!
    const size = new THREE.Vector3()
    box.getSize(size)
    const center = new THREE.Vector3()
    box.getCenter(center)
    
    const maxDim = Math.max(size.x, size.y, size.z)
    const targetSize = 0.75 // 75cm
    const arScale = maxDim > 0 ? targetSize / maxDim : 0.01

    // Create parent group at placement position
    this.arObjectParent = new THREE.Group()
    this.arObjectParent.name = 'AR_PARENT_GROUP'
    this.arObjectParent.position.copy(placePosition)
    this.arObjectParent.scale.set(arScale, arScale, arScale)
    
    // Move mesh to AR parent (removes from original parent)
    this.arObjectParent.add(mesh)
    mesh.position.set(-center.x, -center.y, -center.z)
    mesh.scale.set(1, 1, 1)
    mesh.rotation.set(0, 0, 0)
    mesh.visible = true
    
    // Add lights
    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(1, 2, 1)
    light.name = 'AR_LIGHT'
    this.arObjectParent.add(light)
    
    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    ambient.name = 'AR_AMBIENT'
    this.arObjectParent.add(ambient)
    
    this.scene.add(this.arObjectParent)
    this.arObject = mesh

    // Hide reticle if it exists
    if (this.reticle) {
      this.reticle.visible = false
    }
    this.isPlaced = true

    this.debug(`Placed at ${placePosition.x.toFixed(2)},${placePosition.y.toFixed(2)},${placePosition.z.toFixed(2)} scale:${arScale.toFixed(4)}`)
    return true
  }

  placeObjectAtOrigin(): void {
    this.debug(`placeObjectAtOrigin scene:${!!this.scene}`)
    
    if (!this.scene) {
      this.debug('ERROR: No scene!')
      return
    }
    
    // Find the sculpture mesh - use ORIGINAL, don't clone
    const mesh = this.scene.getObjectByName('DEBUG_LOFT_MESH') as THREE.Mesh | null
    if (!mesh) {
      this.debug('ERROR: No sculpture mesh!')
      return
    }
    
    // Store original state for restoration
    this.originalMesh = mesh
    this.originalMeshParent = mesh.parent
    this.originalPosition.copy(mesh.position)
    this.originalRotation.copy(mesh.rotation)
    this.originalScale.copy(mesh.scale)
    this.originalVisible = mesh.visible
    
    // Calculate scale to fit in 75cm
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox!
    const size = new THREE.Vector3()
    box.getSize(size)
    const center = new THREE.Vector3()
    box.getCenter(center)
    
    const maxDim = Math.max(size.x, size.y, size.z)
    const targetSize = 0.75 // 75cm
    const arScale = maxDim > 0 ? targetSize / maxDim : 0.01
    
    this.debug(`Size:${maxDim.toFixed(1)} Scale:${arScale.toFixed(4)}`)
    
    // Create parent group for gestures
    this.arObjectParent = new THREE.Group()
    this.arObjectParent.name = 'AR_PARENT_GROUP'
    this.arObjectParent.position.set(0, 0, -0.5) // 0.5m in front
    this.arObjectParent.scale.set(arScale, arScale, arScale)
    
    // Move mesh to AR parent (removes from original parent)
    this.arObjectParent.add(mesh)
    mesh.position.set(-center.x, -center.y, -center.z)
    mesh.scale.set(1, 1, 1)
    mesh.rotation.set(0, 0, 0)
    mesh.visible = true
    
    // Add lights for the sculpture
    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(1, 2, 1)
    light.name = 'AR_LIGHT'
    this.arObjectParent.add(light)
    
    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    ambient.name = 'AR_AMBIENT'
    this.arObjectParent.add(ambient)
    
    this.scene.add(this.arObjectParent)
    this.arObject = mesh
    
    this.isPlaced = true
    this.debug(`Sculpture placed`)
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
    this.debug(`Touch: ${event.touches.length} fingers, placed:${this.isPlaced}`)
    
    // If not placed yet, try to place on single tap
    if (!this.isPlaced && event.touches.length === 1) {
      this.placeObject()
      return
    }
    
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
      this.debug(`Pinch start, dist:${this.initialPinchDistance.toFixed(0)}`)
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
    this.debug('Cleaning up AR session')
    
    // Restore original mesh to its original parent and state
    if (this.originalMesh && this.originalMeshParent) {
      this.debug('Restoring original mesh to original parent')
      
      // Move mesh back to original parent
      this.originalMeshParent.add(this.originalMesh)
      
      // Restore original transforms
      this.originalMesh.position.copy(this.originalPosition)
      this.originalMesh.rotation.copy(this.originalRotation)
      this.originalMesh.scale.copy(this.originalScale)
      this.originalMesh.visible = this.originalVisible
      
      this.debug('Original mesh restored')
    }
    
    // Remove AR parent group (just contains lights now, mesh was moved back)
    if (this.arObjectParent && this.scene) {
      // Dispose lights
      this.arObjectParent.traverse((child) => {
        if (child instanceof THREE.Light) {
          child.dispose?.()
        }
      })
      this.scene.remove(this.arObjectParent)
      this.arObjectParent = null
    }
    
    // Reset mesh references
    this.originalMesh = null
    this.originalMeshParent = null
    this.arObject = null

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
      // Stop the XR animation loop
      this.renderer.setAnimationLoop(null)
      this.renderer.xr.enabled = false
      
      // Reset renderer settings for normal 3js rendering
      this.renderer.setClearColor(0x0a0a0a, 1)
      this.renderer.setClearAlpha(1)
    }
    
    // Remove AR objects by stored UUIDs - most reliable method
    if (this.scene && this.arObjectUUIDs.length > 0) {
      this.debug(`Removing ${this.arObjectUUIDs.length} tracked AR objects by UUID`)
      
      for (const uuid of this.arObjectUUIDs) {
        const obj = this.scene.getObjectByProperty('uuid', uuid)
        if (obj) {
          this.debug(`Found and removing UUID: ${uuid}`)
          // Dispose meshes
          obj.traverse((c) => {
            if (c instanceof THREE.Mesh) {
              c.geometry?.dispose()
              if (c.material instanceof THREE.Material) c.material.dispose()
            }
          })
          this.scene.remove(obj)
        } else {
          this.debug(`UUID not found in scene: ${uuid}`)
        }
      }
      this.arObjectUUIDs = []
    }
    
    // Also do a final pass to remove any objects with AR_ prefix names
    if (this.scene) {
      const children = [...this.scene.children]
      for (const child of children) {
        if (child.name?.startsWith('AR_') || (child instanceof THREE.Group && child.scale.x < 0.1 && child.scale.x > 0)) {
          this.debug(`Final cleanup: removing ${child.type} name="${child.name}"`)
          this.scene.remove(child)
        }
      }
    }
    
    this.debug('AR cleanup complete')

    this.config.onSessionEnd?.()
    this.config.onSceneReset?.()
  }

  async endARSession(): Promise<void> {
    this.debug('Exit AR requested')
    if (this.xrSession) {
      try {
        await this.xrSession.end()
      } catch (e) {
        this.debug(`Session end error: ${e}`)
        // Force cleanup even if session.end() fails
        this.onSessionEnd()
      }
    } else {
      // No session but cleanup anyway
      this.onSessionEnd()
    }
  }

  isInARSession(): boolean {
    return this.xrSession !== null
  }

  isObjectPlaced(): boolean {
    return this.isPlaced
  }
}
