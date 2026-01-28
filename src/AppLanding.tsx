import { useState, useEffect, useRef, useCallback } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

import objLoader from './engine/OBJLoader'
import { computeCrossSectionIntersections } from './engine/GeometryDerivation'
import sculptureBuilder, { SculptureData } from './engine/SculptureBuilder'
import lightingController from './engine/LightingController'
import materialController from './engine/MaterialController'
import cameraController from './engine/CameraController'
import { computeHullCameraPositions, createHullGeometry, CameraViewpoint } from './engine/ConvexHullCamera'
import { isWebGPUSupported, getRendererInfo } from './engine/RendererFactory'
import modeController, { AppMode } from './engine/ModeController'
import { ARController } from './engine/ARController'

import { SettingsModal, CameraAnimationSettings } from './ui/SettingsModal'
import { UVDebugModal } from './ui/UVDebugModal'

interface SmoothCameraAnimation {
  isActive: boolean
  curve: THREE.CatmullRomCurve3 | null
  targetCurve: THREE.CatmullRomCurve3 | null
  duration: number
  lookAhead: number
  loop: boolean
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
}

interface DebugSceneProps {
  loftProgress: number
  straighten: number
  onLoaded: () => void
  autoRotate: boolean
  rotateSpeed: number
  sphereRadius: number
  starDensity: number
  cosmicScale: number
  bondDensity: number
  starScale: number
  galaxySize: number
  cameraViewpoint: number
  cameraFov: number
  useGpu: boolean
  onCameraViewpointsComputed: (viewpoints: CameraViewpoint[]) => void
  smoothCameraAnim: SmoothCameraAnimation | null
  onSmoothAnimComplete?: () => void
  showHull: boolean
  arController?: ARController | null
  sceneResetTrigger?: number
  galaxyStars: number
  showPoints: boolean
  pathsValue: number
  showPaths: boolean
  structureValue: number
  showStructure: boolean
  curvedValue: number
  showCurved: boolean
  profiledValue: number
  showProfiled: boolean
}

// Detect lattice type from corner distances and angles
function detectLatticeType(corners: THREE.Vector3[]): { type: 'SC' | 'BCC' | 'FCC', latticeConstant: number } {
  if (corners.length < 2) {
    console.info('[Lattice] Not enough corners, defaulting to SC')
    return { type: 'SC', latticeConstant: 1 }
  }
  
  console.group('[Lattice Detection Analysis]')
  console.info(`Corner count: ${corners.length}`)
  
  // Calculate all pairwise distances
  const distances: number[] = []
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      distances.push(corners[i].distanceTo(corners[j]))
    }
  }
  distances.sort((a, b) => a - b)
  
  // Analyze segment lengths (consecutive corners form segments)
  const segmentLengths: number[] = []
  for (let i = 0; i < corners.length - 1; i++) {
    segmentLengths.push(corners[i].distanceTo(corners[i + 1]))
  }
  const shortestSegment = Math.min(...segmentLengths)
  const avgSegmentLength = segmentLengths.reduce((a, b) => a + b, 0) / segmentLengths.length
  console.info(`Segment lengths: ${segmentLengths.map(d => d.toFixed(2)).join(', ')}`)
  console.info(`Shortest segment: ${shortestSegment.toFixed(3)}, Average: ${avgSegmentLength.toFixed(3)}`)
  
  // Calculate angles between consecutive segments
  const angles: number[] = []
  for (let i = 1; i < corners.length - 1; i++) {
    const v1 = new THREE.Vector3().subVectors(corners[i - 1], corners[i]).normalize()
    const v2 = new THREE.Vector3().subVectors(corners[i + 1], corners[i]).normalize()
    const dot = v1.dot(v2)
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI)
    angles.push(angleDeg)
  }
  console.info(`Angles between segments (degrees): ${angles.map(a => a.toFixed(1)).join(', ')}`)
  
  // Analyze angles for lattice detection
  // SC: 90° angles (cubic)
  // BCC: 109.47° (tetrahedral angle from body center)
  // FCC: 60° or 120° (close-packed)
  let angle90Count = 0, angle109Count = 0, angle60Count = 0, angle120Count = 0
  for (const angle of angles) {
    if (angle > 85 && angle < 95) angle90Count++
    if (angle > 105 && angle < 115) angle109Count++
    if (angle > 55 && angle < 65) angle60Count++
    if (angle > 115 && angle < 125) angle120Count++
  }
  console.info(`Angle analysis: 90°=${angle90Count}, 109°=${angle109Count}, 60°=${angle60Count}, 120°=${angle120Count}`)
  
  // Use median of shortest distances as reference
  const shortestDistances = distances.slice(0, Math.min(corners.length, distances.length))
  const medianDist = shortestDistances[Math.floor(shortestDistances.length / 2)]
  console.info(`Shortest distances: ${shortestDistances.slice(0, 5).map(d => d.toFixed(2)).join(', ')}...`)
  console.info(`Median distance: ${medianDist.toFixed(3)}`)
  
  // Analyze distance ratios
  let scCount = 0, bccCount = 0, fccCount = 0
  for (const d of shortestDistances) {
    const ratio = d / medianDist
    if (ratio > 0.95 && ratio < 1.05) scCount++
    if (ratio > 0.82 && ratio < 0.92) bccCount++
    if (ratio > 0.67 && ratio < 0.77) fccCount++
  }
  console.info(`Distance ratio analysis: SC=${scCount}, BCC=${bccCount}, FCC=${fccCount}`)
  
  // Combined detection using both distances and angles
  let type: 'SC' | 'BCC' | 'FCC' = 'SC'
  let latticeConstant = shortestSegment // Use shortest segment as lattice step size
  
  // Angle-based detection takes priority
  const totalAngles = angles.length
  if (totalAngles > 0) {
    const angle90Ratio = angle90Count / totalAngles
    const angle109Ratio = angle109Count / totalAngles
    const angleFCCRatio = (angle60Count + angle120Count) / totalAngles
    
    console.info(`Angle ratios: 90°=${(angle90Ratio*100).toFixed(0)}%, 109°=${(angle109Ratio*100).toFixed(0)}%, FCC=${(angleFCCRatio*100).toFixed(0)}%`)
    
    if (angleFCCRatio > 0.3 && angleFCCRatio > angle90Ratio && angleFCCRatio > angle109Ratio) {
      type = 'FCC'
    } else if (angle109Ratio > 0.3 && angle109Ratio > angle90Ratio) {
      type = 'BCC'
    } else if (angle90Ratio > 0.3) {
      type = 'SC'
    }
  }
  
  // Fall back to distance-based if angles inconclusive (keep shortest segment as lattice constant)
  if (type === 'SC' && (fccCount > scCount || bccCount > scCount)) {
    if (fccCount > bccCount) {
      type = 'FCC'
    } else {
      type = 'BCC'
    }
  }
  
  console.info(`>>> DETECTED LATTICE: ${type}, constant: ${latticeConstant.toFixed(3)}`)
  console.groupEnd()
  
  return { type, latticeConstant }
}

// Generate lattice points within a sphere, using actual segment vectors as basis
function generateLatticePoints(
  center: THREE.Vector3,
  radius: number,
  latticeConstant: number,
  _type: 'SC' | 'BCC' | 'FCC',
  corners: THREE.Vector3[]
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  
  // Use first corner as lattice origin
  const origin = corners.length > 0 ? corners[0].clone() : center.clone()
  
  console.group(`[Lattice Generation - ${_type}]`)
  console.info(`Origin: (${origin.x.toFixed(3)}, ${origin.y.toFixed(3)}, ${origin.z.toFixed(3)})`)
  console.info(`Lattice constant: ${latticeConstant.toFixed(3)}`)
  
  // Find 3 linearly independent segment vectors from the path
  const basisVectors: THREE.Vector3[] = []
  const usedDirections: THREE.Vector3[] = []
  
  for (let i = 0; i < corners.length - 1 && basisVectors.length < 3; i++) {
    const seg = new THREE.Vector3().subVectors(corners[i + 1], corners[i])
    const segNorm = seg.clone().normalize()
    
    let isIndependent = true
    for (const existing of usedDirections) {
      const dot = Math.abs(segNorm.dot(existing))
      if (dot > 0.99) {
        isIndependent = false
        break
      }
    }
    
    if (isIndependent) {
      const unitVec = segNorm.multiplyScalar(latticeConstant)
      basisVectors.push(unitVec)
      usedDirections.push(segNorm.clone().normalize())
    }
  }
  
  // If we don't have 3 basis vectors, add orthogonal ones
  while (basisVectors.length < 3) {
    const candidates = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1)
    ]
    for (const cand of candidates) {
      let isIndependent = true
      for (const existing of usedDirections) {
        if (Math.abs(cand.dot(existing)) > 0.99) {
          isIndependent = false
          break
        }
      }
      if (isIndependent) {
        basisVectors.push(cand.clone().multiplyScalar(latticeConstant))
        usedDirections.push(cand.clone())
        break
      }
    }
  }
  
  const [b1, b2, b3] = basisVectors
  
  // Generate lattice points using path-derived basis vectors
  // The basis vectors already encode the lattice structure from the path
  // latticeConstant = nearest neighbor distance (not cubic cell edge)
  const halfExtent = Math.ceil(radius / latticeConstant) + 1
  
  for (let i = -halfExtent; i <= halfExtent; i++) {
    for (let j = -halfExtent; j <= halfExtent; j++) {
      for (let k = -halfExtent; k <= halfExtent; k++) {
        const point = origin.clone()
          .addScaledVector(b1, i)
          .addScaledVector(b2, j)
          .addScaledVector(b3, k)
        
        if (point.distanceTo(center) <= radius) {
          points.push(point)
        }
      }
    }
  }
  
  console.info(`[Lattice] Generated ${points.length} ${_type} points`)
  console.groupEnd()
  
  return points
}

function DebugLoftScene({ loftProgress, straighten, onLoaded, autoRotate, rotateSpeed, sphereRadius, starDensity, cosmicScale, bondDensity, starScale, galaxySize, cameraViewpoint, cameraFov, useGpu, onCameraViewpointsComputed, smoothCameraAnim, onSmoothAnimComplete, showHull, arController, sceneResetTrigger, galaxyStars, showPoints, pathsValue, showPaths, structureValue, showStructure, curvedValue, showCurved, profiledValue, showProfiled }: DebugSceneProps) {
  const { scene, gl, camera } = useThree()
  
  // Set up AR controller with renderer, scene, and camera
  useEffect(() => {
    if (arController && gl && scene && camera) {
      arController.setRenderer(gl)
      arController.setScene(scene)
      arController.setCamera(camera as THREE.PerspectiveCamera)
      console.info('[AR] Renderer, scene, and camera set on ARController')
    }
  }, [arController, gl, scene, camera])
  
  // Reset scene after AR exit
  useEffect(() => {
    if (sceneResetTrigger && sceneResetTrigger > 0) {
      console.info('[Scene] Resetting after AR exit')
      
      // Reset camera to initial position
      camera.position.set(40, 30, 40)
      camera.lookAt(0, 0, 0)
      if ('fov' in camera) {
        (camera as THREE.PerspectiveCamera).fov = cameraFov;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix()
      }
      
      // Deep recursive cleanup - find and remove ALL AR artifacts at any level
      const removeARObjects = (parent: THREE.Object3D) => {
        const childrenToRemove: THREE.Object3D[] = []
        
        parent.children.forEach((child) => {
          // Check if this is an AR object
          const isAR = child.name?.startsWith('AR_') || 
                       (child instanceof THREE.Group && child.scale.x < 0.1 && child.scale.x > 0)
          
          if (isAR) {
            console.info(`[Scene Reset] Found AR object: ${child.type} name="${child.name}" scale=${child.scale.x}`)
            childrenToRemove.push(child)
          } else {
            // Recurse into non-AR children
            removeARObjects(child)
          }
        })
        
        childrenToRemove.forEach(child => {
          console.info(`[Scene Reset] Removing: ${child.type} name="${child.name}"`)
          parent.remove(child)
        })
        
        return childrenToRemove.length
      }
      
      let totalRemoved = removeARObjects(scene)
      console.info(`[Scene Reset] Removed ${totalRemoved} AR objects`)
      
      // Reset sculpture mesh if it exists
      const mesh = scene.getObjectByName('DEBUG_LOFT_MESH') as THREE.Mesh | null
      if (mesh) {
        mesh.rotation.set(0, 0, 0)
        mesh.scale.set(1, 1, 1)
        mesh.position.set(0, 0, 0)
        mesh.visible = true
      }
    }
  }, [sceneResetTrigger, camera, scene, cameraFov])
  
  const meshRef = useRef<THREE.Mesh | null>(null)
  const crossSectionsRef = useRef<THREE.Group | null>(null)
  const spheresRef = useRef<THREE.Group | null>(null)
  const starsRef = useRef<THREE.InstancedMesh | null>(null)
  const bondsRef = useRef<THREE.InstancedMesh | null>(null)
  const starPositionsRef = useRef<THREE.Vector3[]>([])
  const latticePointsRef = useRef<THREE.Vector3[]>([])
  const latticeTypeRef = useRef<'SC' | 'BCC' | 'FCC'>('SC')
  const latticeConstantRef = useRef<number>(1)
  const cameraViewpointsRef = useRef<CameraViewpoint[]>([])
  const hullLinesRef = useRef<THREE.LineSegments | null>(null)
  const smoothAnimElapsedRef = useRef<number>(0)
  const animZoomOffsetRef = useRef<number>(1.0)
  const lastAnimDistanceRef = useRef<number | null>(null)
  const targetCameraPos = useRef<THREE.Vector3 | null>(null)
  const targetCameraLookAt = useRef<THREE.Vector3 | null>(null)
  const dataRef = useRef<{
    sortedSections: THREE.Vector3[][]
    sortedNames: string[]
    pathCorners: THREE.Vector3[]
    centroids: THREE.Vector3[]
    boundingSphere: THREE.Sphere
  } | null>(null)
  const controlsRef = useRef<any>(null)
  const [initialized, setInitialized] = useState(false)
  
  // Reference FOV for distance compensation (50mm lens = ~39.6° FOV)
  const baseFovRef = useRef<number>(39.6)
  const baseDistanceRef = useRef<number | null>(null)
  const fovTargetRef = useRef<THREE.Vector3 | null>(null)
  
  // Update camera FOV and distance to keep sculpture at same apparent size
  useEffect(() => {
    if (!initialized) return
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    
    // Store initial distance on first FOV change
    if (baseDistanceRef.current === null) {
      const target = controlsRef.current?.target?.clone() || new THREE.Vector3(0, 0, 0)
      fovTargetRef.current = target
      baseDistanceRef.current = camera.position.distanceTo(target)
    }
    
    // Calculate distance multiplier to maintain same apparent size
    // distance_new = distance_base * tan(baseFov/2) / tan(newFov/2)
    const baseFovRad = (baseFovRef.current * Math.PI) / 180
    const newFovRad = (cameraFov * Math.PI) / 180
    const distanceMultiplier = Math.tan(baseFovRad / 2) / Math.tan(newFovRad / 2)
    const newDistance = baseDistanceRef.current * distanceMultiplier
    
    // Move camera along its current direction from target
    const target = fovTargetRef.current || new THREE.Vector3(0, 0, 0)
    const direction = camera.position.clone().sub(target).normalize()
    camera.position.copy(target.clone().add(direction.multiplyScalar(newDistance)))
    
    camera.fov = cameraFov
    camera.updateProjectionMatrix()
  }, [cameraFov, camera, initialized])

  useEffect(() => {
    async function loadData() {
      lightingController.initialize(scene, gl)
      
      const objData = await objLoader.load('/grasshopper-data/sculpture.obj')
      
      const sortedNames = Array.from(objData.crossSections.keys()).sort((a, b) => {
        const numA = parseInt(a.replace('CROSS_SECTION_', ''), 10)
        const numB = parseInt(b.replace('CROSS_SECTION_', ''), 10)
        return numA - numB
      })
      
      const sortedSections = sortedNames.map(name => objData.crossSections.get(name)!)
      
      // Extract unique path corners from sculpturePath line segment endpoints
      const pathCorners: THREE.Vector3[] = []
      const seen = new Set<string>()
      if (objData.sculpturePath) {
        objData.sculpturePath.forEach(v => {
          const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`
          if (!seen.has(key)) {
            seen.add(key)
            pathCorners.push(v.clone())
          }
        })
      }
      
      // Store path corners for Paths effect
      sculpturePathRef.current = pathCorners
      
      // Store sculpture curve for Curved effect
      if (objData.sculptureCurve && objData.sculptureCurve.length > 0) {
        sculptureCurveRef.current = objData.sculptureCurve.map(v => v.clone())
        console.info(`[Path] Stored sculptureCurve with ${sculptureCurveRef.current.length} points`)
      }
      
      // Calculate centroids for each section (the heartline)
      const centroids = sortedSections.map(section => {
        const centroid = new THREE.Vector3()
        section.forEach(v => centroid.add(v))
        centroid.divideScalar(section.length)
        return centroid
      })
      
      const crossSectionsGroup = new THREE.Group()
      crossSectionsGroup.name = 'CROSS_SECTIONS_WIREFRAME'
      crossSectionsGroup.visible = false
      
      for (let i = 0; i < sortedNames.length; i++) {
        const vertices = sortedSections[i]
        const geo = new THREE.BufferGeometry().setFromPoints(vertices)
        const mat = new THREE.LineBasicMaterial({ color: 0x4488ff })
        const line = new THREE.LineLoop(geo, mat)
        crossSectionsGroup.add(line)
      }
      
      scene.add(crossSectionsGroup)
      crossSectionsRef.current = crossSectionsGroup
      
      const box = new THREE.Box3().setFromObject(crossSectionsGroup)
      const boundingSphere = new THREE.Sphere()
      box.getBoundingSphere(boundingSphere)
      
      // Detect lattice type and generate lattice points (4x bounding sphere)
      const { type: latticeType, latticeConstant } = detectLatticeType(pathCorners)
      latticeTypeRef.current = latticeType
      latticeConstantRef.current = latticeConstant
      const latticeRadius = boundingSphere.radius * 4
      latticePointsRef.current = generateLatticePoints(boundingSphere.center, latticeRadius, latticeConstant, latticeType, pathCorners)
      
      // Pre-generate random star positions (10x bounding sphere)
      // Generate enough to match lattice points or exceed for cosmic view
      const cosmicRadius = boundingSphere.radius * 10
      const numCosmicStars = Math.max(latticePointsRef.current.length, pathCorners.length * 50)
      const unsortedCosmicPositions = Array.from({ length: numCosmicStars }, () => {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        const r = Math.cbrt(Math.random()) * cosmicRadius // cube root for uniform volume distribution
        return new THREE.Vector3(
          boundingSphere.center.x + r * Math.sin(phi) * Math.cos(theta),
          boundingSphere.center.y + r * Math.sin(phi) * Math.sin(theta),
          boundingSphere.center.z + r * Math.cos(phi)
        )
      })
      
      // Sort cosmic positions by nearest lattice point for smooth interpolation
      // This ensures each star moves toward its closest lattice target
      const lattice = latticePointsRef.current
      const sortedCosmicPositions: THREE.Vector3[] = []
      const usedCosmicIndices = new Set<number>()
      
      for (let li = 0; li < lattice.length; li++) {
        const latticePos = lattice[li]
        let bestIdx = -1
        let bestDist = Infinity
        
        // Find closest unused cosmic position to this lattice point
        for (let ci = 0; ci < unsortedCosmicPositions.length; ci++) {
          if (!usedCosmicIndices.has(ci)) {
            const dist = latticePos.distanceTo(unsortedCosmicPositions[ci])
            if (dist < bestDist) {
              bestDist = dist
              bestIdx = ci
            }
          }
        }
        
        if (bestIdx >= 0) {
          usedCosmicIndices.add(bestIdx)
          sortedCosmicPositions.push(unsortedCosmicPositions[bestIdx])
        } else {
          // Fallback: use a random position if none left
          sortedCosmicPositions.push(unsortedCosmicPositions[li % unsortedCosmicPositions.length])
        }
      }
      
      // Add remaining cosmic positions for when numCosmicStars > lattice.length
      for (let ci = 0; ci < unsortedCosmicPositions.length; ci++) {
        if (!usedCosmicIndices.has(ci)) {
          sortedCosmicPositions.push(unsortedCosmicPositions[ci])
        }
      }
      
      starPositionsRef.current = sortedCosmicPositions
      
      dataRef.current = { sortedSections, sortedNames, pathCorners, centroids, boundingSphere }
      
      // Compute convex hull camera viewpoints
      const viewpoints = computeHullCameraPositions(pathCorners)
      cameraViewpointsRef.current = viewpoints
      onCameraViewpointsComputed(viewpoints)
      
      // Create hull wireframe visualization
      const hullGeometry = createHullGeometry(pathCorners)
      if (hullGeometry) {
        const hullMaterial = new THREE.LineBasicMaterial({ color: 0x4a9eff, opacity: 0.6, transparent: true })
        const hullLines = new THREE.LineSegments(hullGeometry, hullMaterial)
        hullLines.name = 'CONVEX_HULL_LINES'
        hullLines.visible = false
        scene.add(hullLines)
        hullLinesRef.current = hullLines
      }
      
      console.info(`[DEBUG] Loaded ${sortedNames.length} cross-sections`)
      console.info(`[DEBUG] Path corners: ${pathCorners.length} unique vertices`)
      console.info(`[DEBUG] Bounding sphere radius: ${boundingSphere.radius.toFixed(2)}, cosmic stars: ${numCosmicStars}, lattice points: ${latticePointsRef.current.length}`)
      
      cameraController.setCamera(camera as THREE.PerspectiveCamera)
      cameraController.centerOnBounds(box)
      
      setInitialized(true)
      onLoaded()
    }
    
    loadData()
    
    return () => {
      if (meshRef.current) scene.remove(meshRef.current)
      if (crossSectionsRef.current) scene.remove(crossSectionsRef.current)
      if (spheresRef.current) scene.remove(spheresRef.current)
      if (starsRef.current) {
        scene.remove(starsRef.current)
        starsRef.current.geometry.dispose()
      }
      if (bondsRef.current) {
        scene.remove(bondsRef.current)
        bondsRef.current.geometry.dispose()
      }
      if (hullLinesRef.current) {
        scene.remove(hullLinesRef.current)
        hullLinesRef.current.geometry.dispose()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, gl, camera])

  // Toggle hull visibility
  useEffect(() => {
    if (hullLinesRef.current) {
      hullLinesRef.current.visible = showHull
    }
  }, [showHull])

  // Reset animation elapsed time and zoom offset when smooth animation starts
  useEffect(() => {
    if (smoothCameraAnim?.isActive) {
      smoothAnimElapsedRef.current = 0
      animZoomOffsetRef.current = 1.0
      lastAnimDistanceRef.current = null
    }
  }, [smoothCameraAnim])

  // Listen for user zoom during animation (wheel/pinch events on canvas)
  useEffect(() => {
    if (!smoothCameraAnim?.isActive) return
    
    const canvas = gl.domElement
    
    // Accumulate wheel delta for hysteresis
    let wheelAccum = 0
    const WHEEL_THRESHOLD = 50
    
    const handleWheel = (e: WheelEvent) => {
      wheelAccum += e.deltaY
      // Only apply zoom when accumulated delta exceeds threshold
      if (Math.abs(wheelAccum) > WHEEL_THRESHOLD) {
        const zoomDelta = wheelAccum > 0 ? 1.15 : 0.87
        animZoomOffsetRef.current = Math.max(0.1, Math.min(20.0, animZoomOffsetRef.current * zoomDelta))
        wheelAccum = 0
      }
      e.preventDefault()
    }
    
    // Track pinch zoom for touch devices with hysteresis
    let lastTouchDistance = 0
    let touchZoomAccum = 1.0
    const TOUCH_THRESHOLD = 0.08
    
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        lastTouchDistance = Math.sqrt(dx * dx + dy * dy)
        touchZoomAccum = 1.0
      }
    }
    
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastTouchDistance > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const newDistance = Math.sqrt(dx * dx + dy * dy)
        touchZoomAccum *= lastTouchDistance / newDistance
        lastTouchDistance = newDistance
        // Only apply when accumulated change exceeds threshold
        if (Math.abs(touchZoomAccum - 1.0) > TOUCH_THRESHOLD) {
          animZoomOffsetRef.current = Math.max(0.1, Math.min(20.0, animZoomOffsetRef.current * touchZoomAccum))
          touchZoomAccum = 1.0
        }
        e.preventDefault()
      }
    }
    
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true })
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    
    return () => {
      canvas.removeEventListener('wheel', handleWheel)
      canvas.removeEventListener('touchstart', handleTouchStart)
      canvas.removeEventListener('touchmove', handleTouchMove)
    }
  }, [smoothCameraAnim?.isActive, gl])

  // Camera viewpoint effect - animate to selected viewpoint
  useEffect(() => {
    if (!initialized || cameraViewpointsRef.current.length === 0) return
    if (cameraViewpoint < 0) {
      // Reset to free camera mode
      targetCameraPos.current = null
      targetCameraLookAt.current = null
      return
    }
    
    const viewpoint = cameraViewpointsRef.current[cameraViewpoint % cameraViewpointsRef.current.length]
    if (viewpoint) {
      targetCameraPos.current = viewpoint.position.clone()
      targetCameraLookAt.current = viewpoint.target.clone()
      console.info(`[Camera] Moving to ${viewpoint.label} (${viewpoint.type})`)
    }
  }, [cameraViewpoint, initialized])

  // Regenerate lattice and cosmic positions when galaxySize changes
  useEffect(() => {
    if (!initialized || !dataRef.current) return
    
    const { pathCorners, boundingSphere } = dataRef.current
    const { type: latticeType, latticeConstant } = detectLatticeType(pathCorners)
    latticeTypeRef.current = latticeType
    latticeConstantRef.current = latticeConstant
    
    // Generate lattice points based on galaxySize (1x-10x bounding sphere radius)
    // Use sphere bounds first to get all potential lattice points
    const latticeRadius = boundingSphere.radius * galaxySize
    latticePointsRef.current = generateLatticePoints(boundingSphere.center, latticeRadius, latticeConstant, latticeType, pathCorners)
    
    // Generate cosmic positions in a sphere matching the galaxy size
    const cosmicRadius = boundingSphere.radius * galaxySize
    const numCosmicStars = Math.max(latticePointsRef.current.length, pathCorners.length * 50)
    const unsortedCosmicPositions = Array.from({ length: numCosmicStars }, () => {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = Math.cbrt(Math.random()) * cosmicRadius
      return new THREE.Vector3(
        boundingSphere.center.x + r * Math.sin(phi) * Math.cos(theta),
        boundingSphere.center.y + r * Math.sin(phi) * Math.sin(theta),
        boundingSphere.center.z + r * Math.cos(phi)
      )
    })
    
    // Sort cosmic positions by nearest lattice point for smooth interpolation
    const lattice = latticePointsRef.current
    const sortedCosmicPositions: THREE.Vector3[] = []
    const usedCosmicIndices = new Set<number>()
    
    for (let li = 0; li < lattice.length; li++) {
      const latticePos = lattice[li]
      let bestIdx = -1
      let bestDist = Infinity
      
      for (let ci = 0; ci < unsortedCosmicPositions.length; ci++) {
        if (!usedCosmicIndices.has(ci)) {
          const dist = latticePos.distanceTo(unsortedCosmicPositions[ci])
          if (dist < bestDist) {
            bestDist = dist
            bestIdx = ci
          }
        }
      }
      
      if (bestIdx >= 0) {
        usedCosmicIndices.add(bestIdx)
        sortedCosmicPositions.push(unsortedCosmicPositions[bestIdx])
      } else {
        sortedCosmicPositions.push(unsortedCosmicPositions[li % unsortedCosmicPositions.length])
      }
    }
    
    for (let ci = 0; ci < unsortedCosmicPositions.length; ci++) {
      if (!usedCosmicIndices.has(ci)) {
        sortedCosmicPositions.push(unsortedCosmicPositions[ci])
      }
    }
    
    starPositionsRef.current = sortedCosmicPositions
    
    console.info(`[Galaxy] Size ${galaxySize.toFixed(1)}x, cubeoctahedron R=${cosmicRadius.toFixed(2)}, lattice: ${latticePointsRef.current.length}, cosmic: ${sortedCosmicPositions.length}`)
  }, [galaxySize, initialized])

  // Galaxy stars effect (using InstancedMesh for performance)
  useEffect(() => {
    if (!initialized || !dataRef.current) return
    
    if (starsRef.current) {
      scene.remove(starsRef.current)
      starsRef.current.geometry.dispose()
    }
    
    if (starDensity <= 0) {
      starsRef.current = null
      return
    }
    
    // Star size: at starScale=1, radius = 0.5 * latticeConstant (spheres just touch)
    // starScale controls how large the stars are relative to this maximum
    const latticeConstant = latticeConstantRef.current
    const maxStarRadius = latticeConstant * 0.5 // Touching spheres
    const starSize = starScale * maxStarRadius
    
    if (starSize <= 0) {
      starsRef.current = null
      return
    }
    
    const latticePoints = latticePointsRef.current
    const cosmicPositions = starPositionsRef.current
    
    // Determine number of stars based on cosmicScale
    // At cosmicScale=0: use cosmic star count (random positions)
    // At cosmicScale=1: use lattice point count (exact lattice positions)
    const numCosmicStars = Math.floor(starDensity * cosmicPositions.length)
    const numLatticeStars = latticePoints.length
    const numStars = Math.round(
      numCosmicStars * (1 - cosmicScale) + numLatticeStars * cosmicScale
    )
    
    if (numStars === 0) {
      starsRef.current = null
      return
    }
    
    const starSegments = useGpu ? 24 : 12
    const starRings = useGpu ? 16 : 8
    const starGeo = new THREE.SphereGeometry(starSize, starSegments, starRings)
    const instancedMesh = new THREE.InstancedMesh(
      starGeo,
      materialController.getMaterial(),
      numStars
    )
    instancedMesh.name = 'GALAXY_STARS_INSTANCED'
    
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    
    for (let i = 0; i < numStars; i++) {
      // Get cosmic position (wrap if needed)
      const cosmicPos = cosmicPositions[i % cosmicPositions.length]
      
      // Get lattice position (wrap if needed)
      const latticePos = latticePoints[i % latticePoints.length]
      
      // Interpolate between cosmic and lattice position
      position.lerpVectors(cosmicPos, latticePos, cosmicScale)
      
      matrix.setPosition(position)
      instancedMesh.setMatrixAt(i, matrix)
    }
    
    instancedMesh.instanceMatrix.needsUpdate = true
    
    scene.add(instancedMesh)
    starsRef.current = instancedMesh
    
  }, [starDensity, starScale, cosmicScale, galaxySize, initialized, scene, useGpu])

  // Atom bonds effect (using InstancedMesh + spatial hashing for O(n) performance)
  // Creates tubes connecting each star to its 12 nearest neighbors
  useEffect(() => {
    if (!initialized || !dataRef.current) return
    
    if (bondsRef.current) {
      scene.remove(bondsRef.current)
      bondsRef.current.geometry.dispose()
    }
    
    if (bondDensity <= 0) {
      bondsRef.current = null
      return
    }
    
    const latticePoints = latticePointsRef.current
    const cosmicPositions = starPositionsRef.current
    const latticeConstant = latticeConstantRef.current
    
    // Use the same star positions as the stars effect
    const numCosmicStars = Math.floor(starDensity * cosmicPositions.length)
    const numLatticeStars = latticePoints.length
    const numStars = Math.round(
      numCosmicStars * (1 - cosmicScale) + numLatticeStars * cosmicScale
    )
    
    if (numStars < 2) {
      bondsRef.current = null
      return
    }
    
    // Calculate current star positions
    const starPositions: THREE.Vector3[] = []
    for (let i = 0; i < numStars; i++) {
      const cosmicPos = cosmicPositions[i % cosmicPositions.length]
      const latticePos = latticePoints[i % latticePoints.length]
      const pos = new THREE.Vector3().lerpVectors(cosmicPos, latticePos, cosmicScale)
      starPositions.push(pos)
    }
    
    // SPATIAL HASHING: O(n) neighbor finding
    // latticeConstant = shortest segment = nearest neighbor distance
    // Use 1.1x to capture neighbors with small tolerance, but not next shell
    const cellSize = latticeConstant * 1.5
    const maxBondDist = latticeConstant * 1.1 // Nearest neighbors + small tolerance
    
    // Build spatial hash: Map<cellKey, pointIndices[]>
    const spatialHash = new Map<string, number[]>()
    const getCellKey = (p: THREE.Vector3) => {
      const cx = Math.floor(p.x / cellSize)
      const cy = Math.floor(p.y / cellSize)
      const cz = Math.floor(p.z / cellSize)
      return `${cx},${cy},${cz}`
    }
    
    // Insert all points into spatial hash - O(n)
    for (let i = 0; i < starPositions.length; i++) {
      const key = getCellKey(starPositions[i])
      if (!spatialHash.has(key)) spatialHash.set(key, [])
      spatialHash.get(key)!.push(i)
    }
    
    // Find neighbors using spatial hash - O(n * k) where k is avg points per 27 cells
    const bonds: { start: THREE.Vector3, end: THREE.Vector3 }[] = []
    const addedBonds = new Set<string>()
    
    for (let i = 0; i < starPositions.length; i++) {
      const pos = starPositions[i]
      const cx = Math.floor(pos.x / cellSize)
      const cy = Math.floor(pos.y / cellSize)
      const cz = Math.floor(pos.z / cellSize)
      
      // Check this cell and 26 adjacent cells
      const candidates: { idx: number, dist: number }[] = []
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const neighborKey = `${cx + dx},${cy + dy},${cz + dz}`
            const cellPoints = spatialHash.get(neighborKey)
            if (cellPoints) {
              for (const j of cellPoints) {
                if (i !== j) {
                  const dist = pos.distanceTo(starPositions[j])
                  if (dist <= maxBondDist) {
                    candidates.push({ idx: j, dist })
                  }
                }
              }
            }
          }
        }
      }
      
      // Sort candidates and take up to 12 nearest
      candidates.sort((a, b) => a.dist - b.dist)
      const neighbors = candidates.slice(0, 12)
      
      for (const neighbor of neighbors) {
        const bondKey = i < neighbor.idx ? `${i}-${neighbor.idx}` : `${neighbor.idx}-${i}`
        if (!addedBonds.has(bondKey)) {
          addedBonds.add(bondKey)
          bonds.push({ start: pos, end: starPositions[neighbor.idx] })
        }
      }
    }
    
    if (bonds.length === 0) {
      bondsRef.current = null
      return
    }
    
    // Bond radius: up to 50% of star diameter, scaled by bondDensity
    // Uses same star size calculation as stars effect (decoupled from corner spheres)
    const maxStarRadius = latticeConstant * 0.5
    const starSize = starScale * maxStarRadius
    const bondRadius = starSize * 0.5 * bondDensity
    
    // Create instanced cylinders for all bonds in ONE draw call
    const bondGeo = new THREE.CylinderGeometry(bondRadius, bondRadius, 1, 8, 1)
    bondGeo.rotateX(Math.PI / 2)
    
    const instancedBonds = new THREE.InstancedMesh(
      bondGeo,
      materialController.getMaterial(),
      bonds.length
    )
    instancedBonds.name = 'ATOM_BONDS_INSTANCED'
    
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const up = new THREE.Vector3(0, 0, 1)
    
    for (let i = 0; i < bonds.length; i++) {
      const { start, end } = bonds[i]
      position.lerpVectors(start, end, 0.5)
      
      const direction = new THREE.Vector3().subVectors(end, start)
      const length = direction.length()
      direction.normalize()
      
      quaternion.setFromUnitVectors(up, direction)
      scale.set(1, 1, length)
      
      matrix.compose(position, quaternion, scale)
      instancedBonds.setMatrixAt(i, matrix)
    }
    
    instancedBonds.instanceMatrix.needsUpdate = true
    scene.add(instancedBonds)
    bondsRef.current = instancedBonds
    
    console.info(`[Bonds] Rendered ${bonds.length} bonds (spatial hash: ${spatialHash.size} cells)`)
    
  }, [bondDensity, starScale, starDensity, cosmicScale, galaxySize, initialized, scene])

  // Hide base scene objects during Paths chapter
  useEffect(() => {
    if (showPaths) {
      // Hide cross sections, corner spheres, hull lines for entire Paths chapter
      if (crossSectionsRef.current) crossSectionsRef.current.visible = false
      if (spheresRef.current) spheresRef.current.visible = false
      if (hullLinesRef.current) hullLinesRef.current.visible = false
      
      // Hide stars and bonds only during white phase (65%+)
      if (pathsValue >= 65) {
        if (starsRef.current) starsRef.current.visible = false
        if (bondsRef.current) bondsRef.current.visible = false
      } else {
        if (starsRef.current) starsRef.current.visible = true
        if (bondsRef.current) bondsRef.current.visible = true
      }
    } else {
      if (starsRef.current) starsRef.current.visible = true
      if (bondsRef.current) bondsRef.current.visible = true
      if (spheresRef.current) spheresRef.current.visible = true
      if (crossSectionsRef.current) crossSectionsRef.current.visible = true
      // Don't auto-show hull - that's controlled by showHull
    }
  }, [showPaths, pathsValue])

  // Corner spheres effect
  useEffect(() => {
    if (!initialized || !dataRef.current) return
    
    if (spheresRef.current) {
      scene.remove(spheresRef.current)
      spheresRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose()
      })
    }
    
    if (sphereRadius <= 0) {
      spheresRef.current = null
      return
    }
    
    const { pathCorners } = dataRef.current
    const sphereGroup = new THREE.Group()
    sphereGroup.name = 'PATH_CORNER_SPHERES'
    
    const sphereSegments = useGpu ? 32 : 16
    const sphereRings = useGpu ? 24 : 12
    const sphereGeo = new THREE.SphereGeometry(sphereRadius, sphereSegments, sphereRings)
    
    pathCorners.forEach(pos => {
      const sphere = new THREE.Mesh(sphereGeo, materialController.getMaterial())
      sphere.position.copy(pos)
      sphereGroup.add(sphere)
    })
    
    console.info(`[DEBUG] Showing ${pathCorners.length} path corner spheres`)
    
    scene.add(sphereGroup)
    spheresRef.current = sphereGroup
    
  }, [sphereRadius, initialized, scene, useGpu])

  useEffect(() => {
    if (!initialized || !dataRef.current) return
    
    const { sortedSections, centroids, pathCorners } = dataRef.current
    
    if (meshRef.current) {
      scene.remove(meshRef.current)
      meshRef.current.geometry.dispose()
    }
    
    // Scale factor: 0 = full size (1.0), 1 = invisible (0)
    // Circle transition starts at 5% scale and continues to 0
    const circlePhaseStart = 0.95 // when scale reaches 5%
    const scale = 1.0 - loftProgress // goes from 1.0 to 0
    
    // Circle blend: only starts after scale reaches 5%
    // loftProgress 0.95 -> 1.0 maps to circleBlend 0 -> 1
    const circleBlend = loftProgress <= circlePhaseStart 
      ? 0 
      : (loftProgress - circlePhaseStart) / (1.0 - circlePhaseStart)
    
    // Straighten: interpolate centroids toward polylinear path between corners
    const straightenedCentroids = centroids.map((centroid, _i) => {
      if (straighten === 0 || pathCorners.length < 2) return centroid.clone()
      
      // Find closest segment on polylinear path
      let minDist = Infinity
      let closestPoint = centroid.clone()
      
      for (let j = 0; j < pathCorners.length - 1; j++) {
        const a = pathCorners[j]
        const b = pathCorners[j + 1]
        const ab = new THREE.Vector3().subVectors(b, a)
        const ap = new THREE.Vector3().subVectors(centroid, a)
        const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.dot(ab)))
        const projected = new THREE.Vector3().copy(a).addScaledVector(ab, t)
        const dist = centroid.distanceTo(projected)
        
        if (dist < minDist) {
          minDist = dist
          closestPoint = projected
        }
      }
      
      return new THREE.Vector3().lerpVectors(centroid, closestPoint, straighten)
    })
    
    // Generate sections: blend between original shape and circular profile
    const numVerts = 32
    
    const transformedSections = sortedSections.map((section, i) => {
      const originalCentroid = centroids[i]
      const newCentroid = straightenedCentroids[i]
      const centroidOffset = new THREE.Vector3().subVectors(newCentroid, originalCentroid)
      
      // When not blending to circle, use original vertices directly (no resampling)
      if (circleBlend === 0) {
        return section.map(v => {
          const scaledPoint = new THREE.Vector3().lerpVectors(originalCentroid, v, scale)
          scaledPoint.add(centroidOffset)
          return scaledPoint
        })
      }
      
      // Calculate average radius from original section
      let avgRadius = 0
      section.forEach(v => avgRadius += v.distanceTo(originalCentroid))
      avgRadius /= section.length
      
      // Get tangent direction for orienting the circle
      let tangent = new THREE.Vector3(0, 0, 1)
      if (i < straightenedCentroids.length - 1) {
        tangent.subVectors(straightenedCentroids[i + 1], newCentroid).normalize()
      } else if (i > 0) {
        tangent.subVectors(newCentroid, straightenedCentroids[i - 1]).normalize()
      }
      
      // Create orthonormal basis for circle
      const up = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize()
      const forward = new THREE.Vector3().crossVectors(right, tangent).normalize()
      
      return Array.from({ length: numVerts }, (_, j) => {
        const angle = (j / numVerts) * Math.PI * 2
        
        // Circular profile point
        const circlePoint = new THREE.Vector3()
          .addScaledVector(right, Math.cos(angle) * avgRadius * scale)
          .addScaledVector(forward, Math.sin(angle) * avgRadius * scale)
          .add(newCentroid)
        
        // Original scaled profile point (resampled to match vertex count)
        const t = j / numVerts
        const srcIdx = t * section.length
        const i0 = Math.floor(srcIdx) % section.length
        const i1 = (i0 + 1) % section.length
        const frac = srcIdx - Math.floor(srcIdx)
        const originalPoint = new THREE.Vector3().lerpVectors(section[i0], section[i1], frac)
        const scaledOriginal = new THREE.Vector3().lerpVectors(originalCentroid, originalPoint, scale)
        scaledOriginal.add(centroidOffset)
        
        // Blend between original shape and circle
        return new THREE.Vector3().lerpVectors(scaledOriginal, circlePoint, circleBlend)
      })
    })
    
    const geometry = createLoftGeometry(transformedSections)
    // Custom normals are computed in createLoftGeometry with seam averaging
    
    const mesh = new THREE.Mesh(geometry, materialController.getMaterial())
    mesh.name = 'DEBUG_LOFT_MESH'
    scene.add(mesh)
    meshRef.current = mesh
    
    // Set mesh as AR object
    if (arController) {
      arController.setARObject(mesh)
      console.info('[AR] Sculpture mesh set as AR object')
    }
    
  }, [loftProgress, straighten, initialized, scene, arController])

  // Galaxy Stars effect
  const galaxyStarsRef = useRef<THREE.Points | null>(null)
  const sculptureRadiusRef = useRef<number>(30) // Default, will be computed from mesh
  
  // Two-sphere collision animation refs
  const collisionSphere1Ref = useRef<THREE.Mesh | null>(null)
  const collisionSphere2Ref = useRef<THREE.Mesh | null>(null)
  const explosionFlashRef = useRef<THREE.Mesh | null>(null)
  const explosionParticlesRef = useRef<THREE.Points | null>(null)
  const collisionAnimStateRef = useRef<{
    phase: 'idle' | 'spheres' | 'approach' | 'collision' | 'explosion' | 'galaxy'
    sphere1Pos: THREE.Vector3
    sphere2Pos: THREE.Vector3
    sphere1Scale: number
    sphere2Scale: number
    explosionProgress: number
    particlePositions: Float32Array | null
    particleVelocities: Float32Array | null
    particleTargets: Float32Array | null
  }>({
    phase: 'idle',
    sphere1Pos: new THREE.Vector3(-15, 8, 5),
    sphere2Pos: new THREE.Vector3(15, -6, -5),
    sphere1Scale: 0,
    sphere2Scale: 0,
    explosionProgress: 0,
    particlePositions: null,
    particleVelocities: null,
    particleTargets: null
  })
  
  // Compute and store sculpture radius when mesh changes
  useEffect(() => {
    if (meshRef.current) {
      const boundingBox = new THREE.Box3().setFromObject(meshRef.current)
      const boundingSphere = new THREE.Sphere()
      boundingBox.getBoundingSphere(boundingSphere)
      sculptureRadiusRef.current = boundingSphere.radius
    }
  }, [initialized])
  
  // Fade sculpture based on Points slider (0-20% = fade out, 20%+ = invisible)
  // Keep hidden during Profiled animation, only show at profiledValue=100
  // Also hide during Paths white phase (65%+)
  useEffect(() => {
    if (meshRef.current) {
      // Hide during Paths white phase (65%+)
      if (showPaths && pathsValue >= 65) {
        meshRef.current.visible = false
        return
      }
      
      if (showProfiled) {
        // During Profiled phase - hide original mesh (Profiled effect draws its own)
        // Only show at 100% when animation is complete
        if (profiledValue >= 100) {
          meshRef.current.visible = true
          const material = meshRef.current.material as THREE.MeshStandardMaterial
          if (material) {
            material.transparent = false
            material.opacity = 1
          }
        } else {
          meshRef.current.visible = false
        }
      } else if (!showPoints) {
        // Not in Points mode - fully visible
        meshRef.current.visible = true
        const material = meshRef.current.material as THREE.MeshStandardMaterial
        if (material) {
          material.transparent = false
          material.opacity = 1
        }
      } else {
        // In Points mode - fade based on slider (0-20 = fade, 20+ = invisible)
        const fadeProgress = Math.min(galaxyStars / 20, 1) // 0-20% slider = 0-100% fade
        const opacity = 1 - fadeProgress
        
        if (opacity <= 0) {
          meshRef.current.visible = false
        } else {
          meshRef.current.visible = true
          const material = meshRef.current.material as THREE.MeshStandardMaterial
          if (material) {
            material.transparent = true
            material.opacity = opacity
          }
        }
      }
    }
  }, [showPoints, showPaths, pathsValue, showProfiled, profiledValue, galaxyStars])
  
  // Pre-computed star positions pool (seeded for determinism)
  const starPoolRef = useRef<{ positions: Float32Array, colors: Float32Array } | null>(null)
  const maxStars = 5000
  
  // Initialize star pool once with seeded random
  useEffect(() => {
    if (starPoolRef.current) return // Already initialized
    
    // Seeded random number generator (mulberry32)
    const seed = 12345
    let state = seed
    const seededRandom = () => {
      state = (state + 0x6D2B79F5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    
    const sphereRadius = sculptureRadiusRef.current * 3
    const positions = new Float32Array(maxStars * 3)
    const colors = new Float32Array(maxStars * 3)
    
    for (let i = 0; i < maxStars; i++) {
      // Seeded spherical distribution
      const r = sphereRadius * Math.cbrt(seededRandom())
      const theta = seededRandom() * Math.PI * 2
      const phi = Math.acos(2 * seededRandom() - 1)
      
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)
      
      // Warm white colors (seeded)
      const colorVariation = seededRandom()
      colors[i * 3] = 0.9 + colorVariation * 0.1
      colors[i * 3 + 1] = 0.85 + colorVariation * 0.15
      colors[i * 3 + 2] = 0.8 + colorVariation * 0.2
    }
    
    starPoolRef.current = { positions, colors }
  }, [])
  
  // Two-sphere collision animation effect
  // Phases: 0-20 = sculpture fade, 20-40 = spheres emerge, 40-70 = approach & collide, 70-100 = explosion to galaxy
  useEffect(() => {
    const state = collisionAnimStateRef.current
    const sphereRadius = sculptureRadiusRef.current
    
    // Cleanup function for all collision objects
    const cleanup = () => {
      if (collisionSphere1Ref.current) {
        scene.remove(collisionSphere1Ref.current)
        collisionSphere1Ref.current.geometry.dispose()
        ;(collisionSphere1Ref.current.material as THREE.Material).dispose()
        collisionSphere1Ref.current = null
      }
      if (collisionSphere2Ref.current) {
        scene.remove(collisionSphere2Ref.current)
        collisionSphere2Ref.current.geometry.dispose()
        ;(collisionSphere2Ref.current.material as THREE.Material).dispose()
        collisionSphere2Ref.current = null
      }
      if (explosionFlashRef.current) {
        scene.remove(explosionFlashRef.current)
        explosionFlashRef.current.geometry.dispose()
        ;(explosionFlashRef.current.material as THREE.Material).dispose()
        explosionFlashRef.current = null
      }
      if (explosionParticlesRef.current) {
        scene.remove(explosionParticlesRef.current)
        explosionParticlesRef.current.geometry.dispose()
        ;(explosionParticlesRef.current.material as THREE.Material).dispose()
        explosionParticlesRef.current = null
      }
      if (galaxyStarsRef.current) {
        scene.remove(galaxyStarsRef.current)
        galaxyStarsRef.current.geometry.dispose()
        ;(galaxyStarsRef.current.material as THREE.PointsMaterial).dispose()
        galaxyStarsRef.current = null
      }
    }
    
    if (!showPoints || galaxyStars <= 20) {
      cleanup()
      state.phase = 'idle'
      return
    }
    
    // Hide Points chapter stars when Paths is in dissolve/contraction phase (35%+)
    if (showPaths && pathsValue >= 35) {
      // Fade out and hide the explosion particles
      if (explosionParticlesRef.current) {
        const fadeProgress = Math.min(1, (pathsValue - 35) / 15) // Fully hidden by 50%
        const material = explosionParticlesRef.current.material as THREE.PointsMaterial
        material.opacity = Math.max(0, 1 - fadeProgress * 2)
        if (fadeProgress >= 0.5) {
          explosionParticlesRef.current.visible = false
        }
      }
      if (galaxyStarsRef.current) {
        galaxyStarsRef.current.visible = false
      }
      // Also hide collision spheres during Paths dissolve
      if (collisionSphere1Ref.current) collisionSphere1Ref.current.visible = false
      if (collisionSphere2Ref.current) collisionSphere2Ref.current.visible = false
      if (explosionFlashRef.current) explosionFlashRef.current.visible = false
      return
    } else {
      // Make sure they're visible when not in dissolve phase
      if (explosionParticlesRef.current) {
        explosionParticlesRef.current.visible = true
        const material = explosionParticlesRef.current.material as THREE.PointsMaterial
        material.opacity = 1.0
      }
      if (galaxyStarsRef.current) {
        galaxyStarsRef.current.visible = true
      }
    }
    
    // Phase 1: First sphere appears along elliptical arc (20-35)
    if (galaxyStars > 20 && galaxyStars <= 35) {
      // Remove all later-phase objects when scrubbing back
      if (explosionFlashRef.current) {
        scene.remove(explosionFlashRef.current)
        explosionFlashRef.current.geometry.dispose()
        ;(explosionFlashRef.current.material as THREE.Material).dispose()
        explosionFlashRef.current = null
      }
      if (explosionParticlesRef.current) {
        scene.remove(explosionParticlesRef.current)
        explosionParticlesRef.current.geometry.dispose()
        ;(explosionParticlesRef.current.material as THREE.Material).dispose()
        explosionParticlesRef.current = null
      }
      if (galaxyStarsRef.current) {
        scene.remove(galaxyStarsRef.current)
        galaxyStarsRef.current.geometry.dispose()
        ;(galaxyStarsRef.current.material as THREE.PointsMaterial).dispose()
        galaxyStarsRef.current = null
      }
      if (collisionSphere2Ref.current) {
        scene.remove(collisionSphere2Ref.current)
        collisionSphere2Ref.current.geometry.dispose()
        ;(collisionSphere2Ref.current.material as THREE.Material).dispose()
        collisionSphere2Ref.current = null
      }
      
      const progress = (galaxyStars - 20) / 15 // 0 to 1
      const maxSphereSize = sphereRadius * 0.25
      // Sphere grows from tiny to full size
      const currentSize = maxSphereSize * Math.min(1, progress * 2) // Full size by progress=0.5
      
      // Create sphere 1 once (high resolution, fully opaque sculpture material)
      if (!collisionSphere1Ref.current) {
        const geo = new THREE.SphereGeometry(1, 128, 96)
        const mat = materialController.getMaterial().clone()
        mat.transparent = false
        mat.opacity = 1
        mat.depthWrite = true
        const mesh = new THREE.Mesh(geo, mat)
        mesh.name = 'COLLISION_SPHERE_1'
        scene.add(mesh)
        collisionSphere1Ref.current = mesh
      }
      
      // Sphere 1 follows a smooth curved path using quadratic bezier
      // Use unified t calculation: slider 20-65 maps to bezier t=0-1
      const t = (galaxyStars - 20) / 45 // Direct mapping: 0 to 1 over full journey
      
      // Control points for smooth quadratic bezier curve
      const p0 = new THREE.Vector3(sphereRadius * 2.5, sphereRadius * 0.3, sphereRadius * 0.3) // Start: right side
      const p1 = new THREE.Vector3(-sphereRadius * 1.5, sphereRadius * 1.2, sphereRadius * 0.2) // Control: upper left arc
      const p2 = new THREE.Vector3(0, 0, 0) // End: center (collision point)
      
      // Quadratic bezier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
      const oneMinusT = 1 - t
      state.sphere1Pos.set(
        oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x,
        oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y,
        oneMinusT * oneMinusT * p0.z + 2 * oneMinusT * t * p1.z + t * t * p2.z
      )
      
      collisionSphere1Ref.current.position.copy(state.sphere1Pos)
      collisionSphere1Ref.current.scale.setScalar(Math.max(0.01, currentSize))
      
      state.sphere1Scale = currentSize
      state.phase = 'spheres'
    }
    
    // Phase 2: Second sphere appears, both approach for collision (35-55)
    else if (galaxyStars > 35 && galaxyStars <= 55) {
      // Remove later-phase objects when scrubbing back
      if (explosionFlashRef.current) {
        scene.remove(explosionFlashRef.current)
        explosionFlashRef.current.geometry.dispose()
        ;(explosionFlashRef.current.material as THREE.Material).dispose()
        explosionFlashRef.current = null
      }
      if (explosionParticlesRef.current) {
        scene.remove(explosionParticlesRef.current)
        explosionParticlesRef.current.geometry.dispose()
        ;(explosionParticlesRef.current.material as THREE.Material).dispose()
        explosionParticlesRef.current = null
      }
      
      const progress = (galaxyStars - 35) / 20 // 0 to 1
      const maxSphereSize = sphereRadius * 0.25
      
      // Create sphere 1 if not exists
      if (!collisionSphere1Ref.current) {
        const geo = new THREE.SphereGeometry(1, 128, 96)
        const mat = materialController.getMaterial().clone()
        mat.transparent = false
        mat.opacity = 1
        mat.depthWrite = true
        const mesh = new THREE.Mesh(geo, mat)
        mesh.name = 'COLLISION_SPHERE_1'
        scene.add(mesh)
        collisionSphere1Ref.current = mesh
      }
      
      // Create sphere 2 once (surprise entrance from opposite side)
      if (!collisionSphere2Ref.current) {
        const geo = new THREE.SphereGeometry(1, 128, 96)
        const mat = materialController.getMaterial().clone()
        mat.transparent = false
        mat.opacity = 1
        mat.depthWrite = true
        const mesh = new THREE.Mesh(geo, mat)
        mesh.name = 'COLLISION_SPHERE_2'
        scene.add(mesh)
        collisionSphere2Ref.current = mesh
      }
      
      // Sphere 1 continues on smooth bezier curve
      // Use unified t calculation: slider 20-65 maps to bezier t=0-1
      const t = (galaxyStars - 20) / 45 // Direct mapping for continuity
      
      // Same control points as phase 1 for continuity
      const p0 = new THREE.Vector3(sphereRadius * 2.5, sphereRadius * 0.3, sphereRadius * 0.3)
      const p1 = new THREE.Vector3(-sphereRadius * 1.5, sphereRadius * 1.2, sphereRadius * 0.2)
      const p2 = new THREE.Vector3(0, 0, 0)
      
      // Quadratic bezier
      const oneMinusT = 1 - t
      state.sphere1Pos.set(
        oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x,
        oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y,
        oneMinusT * oneMinusT * p0.z + 2 * oneMinusT * t * p1.z + t * t * p2.z
      )
      
      // Sphere 2 follows smooth bezier curve from right side
      // Use unified t calculation: slider 35-65 maps to bezier t=0-1
      const t2 = (galaxyStars - 35) / 30 // Direct mapping for continuity
      
      // Control points for sphere 2's bezier curve
      const q0 = new THREE.Vector3(sphereRadius * 3, -sphereRadius * 0.5, sphereRadius * 0.5) // Start: far right
      const q1 = new THREE.Vector3(sphereRadius * 1.0, -sphereRadius * 0.3, sphereRadius * 0.3) // Control: gentle curve
      const q2 = new THREE.Vector3(0, 0, 0) // End: center (collision point)
      
      // Quadratic bezier for sphere 2
      const oneMinusT2 = 1 - t2
      state.sphere2Pos.set(
        oneMinusT2 * oneMinusT2 * q0.x + 2 * oneMinusT2 * t2 * q1.x + t2 * t2 * q2.x,
        oneMinusT2 * oneMinusT2 * q0.y + 2 * oneMinusT2 * t2 * q1.y + t2 * t2 * q2.y,
        oneMinusT2 * oneMinusT2 * q0.z + 2 * oneMinusT2 * t2 * q1.z + t2 * t2 * q2.z
      )
      
      // Sphere 2 grows as it appears
      const sphere2Size = maxSphereSize * Math.min(1, progress * 3) // Quick grow at start
      
      collisionSphere1Ref.current.position.copy(state.sphere1Pos)
      collisionSphere1Ref.current.scale.setScalar(maxSphereSize)
      collisionSphere2Ref.current.position.copy(state.sphere2Pos)
      collisionSphere2Ref.current.scale.setScalar(Math.max(0.01, sphere2Size))
      
      state.sphere1Scale = maxSphereSize
      state.sphere2Scale = sphere2Size
      state.phase = 'approach'
    }
    
    // Phase 3: Final rapid approach and collision (55-65)
    else if (galaxyStars > 55 && galaxyStars <= 65) {
      // Remove later-phase objects when scrubbing back
      if (explosionFlashRef.current) {
        scene.remove(explosionFlashRef.current)
        explosionFlashRef.current.geometry.dispose()
        ;(explosionFlashRef.current.material as THREE.Material).dispose()
        explosionFlashRef.current = null
      }
      if (explosionParticlesRef.current) {
        scene.remove(explosionParticlesRef.current)
        explosionParticlesRef.current.geometry.dispose()
        ;(explosionParticlesRef.current.material as THREE.Material).dispose()
        explosionParticlesRef.current = null
      }
      
      const maxSphereSize = sphereRadius * 0.25
      
      // Create spheres if they don't exist (for slider scrubbing)
      if (!collisionSphere1Ref.current) {
        const geo = new THREE.SphereGeometry(1, 128, 96)
        const mat = materialController.getMaterial().clone()
        mat.transparent = false
        mat.opacity = 1
        mat.depthWrite = true
        const mesh = new THREE.Mesh(geo, mat)
        mesh.name = 'COLLISION_SPHERE_1'
        scene.add(mesh)
        collisionSphere1Ref.current = mesh
      }
      if (!collisionSphere2Ref.current) {
        const geo = new THREE.SphereGeometry(1, 128, 96)
        const mat = materialController.getMaterial().clone()
        mat.transparent = false
        mat.opacity = 1
        mat.depthWrite = true
        const mesh = new THREE.Mesh(geo, mat)
        mesh.name = 'COLLISION_SPHERE_2'
        scene.add(mesh)
        collisionSphere2Ref.current = mesh
      }
      
      // Sphere 1 continues on smooth bezier curve - final stretch
      // Use unified t calculation: slider 20-65 maps to bezier t=0-1
      const t = (galaxyStars - 20) / 45 // Direct mapping for continuity
      
      // Same control points for continuity
      const p0 = new THREE.Vector3(sphereRadius * 2.5, sphereRadius * 0.3, sphereRadius * 0.3)
      const p1 = new THREE.Vector3(-sphereRadius * 1.5, sphereRadius * 1.2, sphereRadius * 0.2)
      const p2 = new THREE.Vector3(0, 0, 0)
      
      // Quadratic bezier
      const oneMinusT = 1 - t
      state.sphere1Pos.set(
        oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x,
        oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y,
        oneMinusT * oneMinusT * p0.z + 2 * oneMinusT * t * p1.z + t * t * p2.z
      )
      
      // Sphere 2 continues on smooth bezier curve - final stretch
      // Use unified t calculation: slider 35-65 maps to bezier t=0-1
      const t2 = (galaxyStars - 35) / 30 // Direct mapping for continuity
      
      // Same control points for sphere 2 continuity
      const q0 = new THREE.Vector3(sphereRadius * 3, -sphereRadius * 0.5, sphereRadius * 0.5)
      const q1 = new THREE.Vector3(sphereRadius * 1.0, -sphereRadius * 0.3, sphereRadius * 0.3)
      const q2 = new THREE.Vector3(0, 0, 0)
      
      // Quadratic bezier for sphere 2
      const oneMinusT2 = 1 - t2
      state.sphere2Pos.set(
        oneMinusT2 * oneMinusT2 * q0.x + 2 * oneMinusT2 * t2 * q1.x + t2 * t2 * q2.x,
        oneMinusT2 * oneMinusT2 * q0.y + 2 * oneMinusT2 * t2 * q1.y + t2 * t2 * q2.y,
        oneMinusT2 * oneMinusT2 * q0.z + 2 * oneMinusT2 * t2 * q1.z + t2 * t2 * q2.z
      )
      
      collisionSphere1Ref.current.position.copy(state.sphere1Pos)
      collisionSphere1Ref.current.scale.setScalar(maxSphereSize)
      collisionSphere2Ref.current.position.copy(state.sphere2Pos)
      collisionSphere2Ref.current.scale.setScalar(maxSphereSize)
      
      state.phase = 'approach'
    }
    
    // Phase 4: Collision flash (65-72) - high-res sphere with sculpture material
    else if (galaxyStars > 65 && galaxyStars <= 72) {
      // Remove later-phase objects when scrubbing back
      if (explosionParticlesRef.current) {
        scene.remove(explosionParticlesRef.current)
        explosionParticlesRef.current.geometry.dispose()
        ;(explosionParticlesRef.current.material as THREE.Material).dispose()
        explosionParticlesRef.current = null
      }
      
      const flashProgress = (galaxyStars - 65) / 7 // 0 to 1
      
      // Remove collision spheres
      if (collisionSphere1Ref.current) {
        scene.remove(collisionSphere1Ref.current)
        collisionSphere1Ref.current.geometry.dispose()
        ;(collisionSphere1Ref.current.material as THREE.Material).dispose()
        collisionSphere1Ref.current = null
      }
      if (collisionSphere2Ref.current) {
        scene.remove(collisionSphere2Ref.current)
        collisionSphere2Ref.current.geometry.dispose()
        ;(collisionSphere2Ref.current.material as THREE.Material).dispose()
        collisionSphere2Ref.current = null
      }
      
      // Create explosion flash sphere (high-res, sculpture material)
      if (!explosionFlashRef.current) {
        const geo = new THREE.SphereGeometry(1, 128, 96)
        const mat = materialController.getMaterial().clone()
        mat.transparent = true
        mat.opacity = 1
        mat.emissive = new THREE.Color(0xffffff)
        mat.emissiveIntensity = 2
        const mesh = new THREE.Mesh(geo, mat)
        mesh.name = 'EXPLOSION_FLASH'
        scene.add(mesh)
        explosionFlashRef.current = mesh
      }
      
      // Flash grows rapidly and fades
      const flashSize = sphereRadius * (0.3 + flashProgress * 1.5)
      explosionFlashRef.current.scale.setScalar(flashSize)
      const mat = explosionFlashRef.current.material as THREE.MeshStandardMaterial
      mat.opacity = 1 - flashProgress * 0.7
      mat.emissiveIntensity = 2 * (1 - flashProgress)
      
      state.phase = 'collision'
    }
    
    // Phase 5: Explosion particles scatter to galaxy (72-100)
    else if (galaxyStars > 72) {
      const progress = (galaxyStars - 72) / 28 // 0 to 1
      
      // Remove flash
      if (explosionFlashRef.current) {
        scene.remove(explosionFlashRef.current)
        explosionFlashRef.current.geometry.dispose()
        ;(explosionFlashRef.current.material as THREE.Material).dispose()
        explosionFlashRef.current = null
      }
      
      // Create or update explosion particles
      if (!explosionParticlesRef.current && starPoolRef.current) {
        // Initialize particle positions at center, velocities outward
        const numParticles = maxStars
        const positions = new Float32Array(numParticles * 3)
        const colors = new Float32Array(numParticles * 3)
        
        // Copy colors from star pool
        colors.set(starPoolRef.current.colors)
        
        // All particles start at center
        for (let i = 0; i < numParticles; i++) {
          positions[i * 3] = 0
          positions[i * 3 + 1] = 0
          positions[i * 3 + 2] = 0
        }
        
        // Store target positions (final galaxy positions)
        state.particleTargets = new Float32Array(starPoolRef.current.positions)
        state.particlePositions = positions
        
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        
        // Create circular texture for round points
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 64
        const ctx = canvas.getContext('2d')!
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
        gradient.addColorStop(0, 'rgba(255,255,255,1)')
        gradient.addColorStop(0.5, 'rgba(255,255,255,0.8)')
        gradient.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 64, 64)
        const circleTexture = new THREE.CanvasTexture(canvas)
        
        const material = new THREE.PointsMaterial({
          size: 0.6,
          vertexColors: true,
          transparent: true,
          opacity: 1.0,
          sizeAttenuation: true,
          map: circleTexture,
          alphaMap: circleTexture,
          depthWrite: false,
        })
        
        const particles = new THREE.Points(geometry, material)
        particles.name = 'EXPLOSION_PARTICLES'
        scene.add(particles)
        explosionParticlesRef.current = particles
      }
      
      // Animate particles from center to final galaxy positions
      if (explosionParticlesRef.current && state.particleTargets && state.particlePositions) {
        const positions = explosionParticlesRef.current.geometry.getAttribute('position') as THREE.BufferAttribute
        const targets = state.particleTargets
        
        // Ease-out for explosion settling
        const easeOut = 1 - Math.pow(1 - progress, 3)
        
        for (let i = 0; i < maxStars; i++) {
          // Interpolate from center (0,0,0) to target position
          positions.array[i * 3] = targets[i * 3] * easeOut
          positions.array[i * 3 + 1] = targets[i * 3 + 1] * easeOut
          positions.array[i * 3 + 2] = targets[i * 3 + 2] * easeOut
        }
        
        positions.needsUpdate = true
      }
      
      state.phase = 'explosion'
      state.explosionProgress = progress
    }
    
  }, [galaxyStars, showPoints, showPaths, pathsValue, scene])

  // Paths effect - animated paths through star field
  const pathsGroupRef = useRef<THREE.Group | null>(null)
  const galaxyStarPositionsRef = useRef<THREE.Vector3[]>([])
  const shootingStarsRef = useRef<{ mesh: THREE.Mesh, head: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3 }[]>([])
  const animatedShapesRef = useRef<{ line: THREE.Line, points: THREE.Vector3[], progress: number, speed: number, segmentIndex: number }[]>([])
  const sculpturePathRef = useRef<THREE.Vector3[]>([])
  const sculptureCurveRef = useRef<THREE.Vector3[]>([])
  const _pathsPhaseRef = useRef<number>(-1) // Track current phase to avoid recreating on every slider tick
  
  // Store star positions when explosion particles are created (for paths effect)
  useEffect(() => {
    // Use explosion particles or star pool for star positions
    if (explosionParticlesRef.current && galaxyStars > 75) {
      const positions = explosionParticlesRef.current.geometry.getAttribute('position')
      if (positions) {
        const stars: THREE.Vector3[] = []
        for (let i = 0; i < positions.count; i++) {
          stars.push(new THREE.Vector3(
            positions.getX(i),
            positions.getY(i),
            positions.getZ(i)
          ))
        }
        galaxyStarPositionsRef.current = stars
      }
    } else if (starPoolRef.current && galaxyStars > 75) {
      // Use star pool positions directly
      const positions = starPoolRef.current.positions
      const stars: THREE.Vector3[] = []
      for (let i = 0; i < maxStars; i++) {
        stars.push(new THREE.Vector3(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2]
        ))
      }
      galaxyStarPositionsRef.current = stars
    }
  }, [galaxyStars, showPoints])
  
  // Constellation patterns (reserved for future use)
  const _constellations = {
    bigDipper: [
      [0, 0, 0], [1.5, 0.2, 0.5], [2.8, 0.5, 0.8], [4.2, 0.3, 0.4],
      [5.2, -0.8, 0.2], [5.8, 0.8, 0.6], [7.0, 1.0, 0.3]
    ],
    orion: [
      [0, 2, 0], [1, 1, 0], [2, 0, 0], [1, -1, 0], [0, -2, 0], // belt and body
      [-1, 1.5, 0], [2.5, 1.5, 0] // shoulders
    ],
    triangle: [[0, 1, 0], [1, -0.5, 0], [-1, -0.5, 0], [0, 1, 0]],
    square: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]],
    pentagon: [[0, 1, 0], [0.95, 0.31, 0], [0.59, -0.81, 0], [-0.59, -0.81, 0], [-0.95, 0.31, 0], [0, 1, 0]]
  }
  
  // Setup paths based on slider phase - redesigned cinematic flow
  // Phase sequence:
  // 0-5%: End state of Points chapter (galaxy stars)
  // 5-20%: Shooting stars animate between points
  // 20-35%: Geometric shapes form (triangle, square)
  // 35-50%: Faint lines reveal connecting neighboring points
  // 50-65%: Zoom in, all points/lines contract inward
  // 65-72%: White flash transition
  // 72-80%: White space with black speck
  // 80-100%: Zoom into speck, reveal lattice structure
  useEffect(() => {
    // Cleanup existing
    if (pathsGroupRef.current) {
      scene.remove(pathsGroupRef.current)
      pathsGroupRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose())
          } else {
            ;(obj.material as THREE.Material).dispose()
          }
        }
      })
      pathsGroupRef.current = null
    }
    shootingStarsRef.current = []
    animatedShapesRef.current = []
    
    if (!showPaths || pathsValue === 0) {
      // Restore scene background to default when Paths is inactive
      scene.background = new THREE.Color(0x0a0a0a)
      return
    }
    
    // Restore scene background if before white phase
    if (pathsValue < 65) {
      scene.background = new THREE.Color(0x0a0a0a)
    }
    
    const group = new THREE.Group()
    group.name = 'PATHS_GROUP'
    const sphereRadius = sculptureRadiusRef.current * 3
    const stars = galaxyStarPositionsRef.current
    
    // Get lattice configuration from sculpture path
    const pathCorners = sculpturePathRef.current
    const latticeConstant = latticeConstantRef.current
    
    // Calculate path center for lattice generation
    const pathCenter = new THREE.Vector3()
    if (pathCorners.length > 0) {
      pathCorners.forEach(p => pathCenter.add(p))
      pathCenter.divideScalar(pathCorners.length)
    }
    
    // Define fixed shape positions - closer to center, smaller shapes
    const shapePositions = [
      new THREE.Vector3(-sphereRadius * 0.25, sphereRadius * 0.18, sphereRadius * 0.08),
      new THREE.Vector3(sphereRadius * 0.22, sphereRadius * 0.12, -sphereRadius * 0.1),
      new THREE.Vector3(sphereRadius * 0.05, -sphereRadius * 0.22, sphereRadius * 0.15),
      new THREE.Vector3(-sphereRadius * 0.18, -sphereRadius * 0.12, -sphereRadius * 0.08),
      new THREE.Vector3(sphereRadius * 0.25, -sphereRadius * 0.08, sphereRadius * 0.12),
    ]
    
    // Fixed shooting star trajectories - start from edges, end at shape vertices
    const shootingStarPaths = [
      { start: new THREE.Vector3(-sphereRadius * 0.8, sphereRadius * 0.5, 0), end: shapePositions[0].clone() },
      { start: new THREE.Vector3(sphereRadius * 0.7, sphereRadius * 0.6, -sphereRadius * 0.3), end: shapePositions[1].clone() },
      { start: new THREE.Vector3(sphereRadius * 0.5, -sphereRadius * 0.7, sphereRadius * 0.4), end: shapePositions[2].clone() },
      { start: new THREE.Vector3(-sphereRadius * 0.6, -sphereRadius * 0.5, -sphereRadius * 0.4), end: shapePositions[3].clone() },
      { start: new THREE.Vector3(sphereRadius * 0.8, sphereRadius * 0.15, sphereRadius * 0.5), end: shapePositions[4].clone() },
    ]
    
    // Phase 1: End state of Points chapter - galaxy stars (0-5%)
    if (pathsValue <= 5) {
      // Galaxy stars are already visible from the Points chapter
      // Add subtle twinkling enhancement
      const twinkleCount = Math.min(50, stars.length)
      if (twinkleCount > 0) {
        const twinklePositions: number[] = []
        const twinkleProgress = pathsValue / 5
        
        for (let i = 0; i < twinkleCount; i++) {
          const starIdx = Math.floor((i / twinkleCount) * stars.length)
          const star = stars[starIdx] || new THREE.Vector3(
            (Math.random() - 0.5) * sphereRadius * 2,
            (Math.random() - 0.5) * sphereRadius * 2,
            (Math.random() - 0.5) * sphereRadius * 2
          )
          twinklePositions.push(star.x, star.y, star.z)
        }
        
        const twinkleGeo = new THREE.BufferGeometry()
        twinkleGeo.setAttribute('position', new THREE.Float32BufferAttribute(twinklePositions, 3))
        
        const twinkleMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: sphereRadius * 0.02,
          transparent: true,
          opacity: 0.6 + twinkleProgress * 0.3,
          sizeAttenuation: true
        })
        
        group.add(new THREE.Points(twinkleGeo, twinkleMat))
      }
    }
    
    // Phase 2: Shooting stars with connecting trails (5-20%)
    else if (pathsValue <= 20) {
      const progress = (pathsValue - 5) / 15 // 0 to 1
      
      shootingStarPaths.forEach((path, i) => {
        const starAppearTime = i * 0.15
        const starProgress = Math.max(0, Math.min(1, (progress - starAppearTime) / 0.4))
        
        if (starProgress <= 0) return
        
        const headPos = new THREE.Vector3().lerpVectors(path.start, path.end, starProgress)
        
        const trailSegments = 20
        const trailPositions: number[] = []
        const trailColors: number[] = []
        
        for (let j = 0; j <= trailSegments; j++) {
          const t = j / trailSegments
          const segProgress = t * starProgress
          const segPos = new THREE.Vector3().lerpVectors(path.start, path.end, segProgress)
          trailPositions.push(segPos.x, segPos.y, segPos.z)
          const brightness = t * t * 0.9 + 0.1
          trailColors.push(brightness, brightness, brightness * 0.95)
        }
        
        const trailGeo = new THREE.BufferGeometry()
        trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3))
        trailGeo.setAttribute('color', new THREE.Float32BufferAttribute(trailColors, 3))
        
        const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })
        group.add(new THREE.Line(trailGeo, trailMat))
        
        if (starProgress < 1) {
          const headGeo = new THREE.SphereGeometry(sphereRadius * 0.006, 8, 6)
          const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
          const headMesh = new THREE.Mesh(headGeo, headMat)
          headMesh.position.copy(headPos)
          group.add(headMesh)
        }
      })
    }
    
    // Phase 3: Geometric shapes form - triangle then square (20-35%)
    else if (pathsValue <= 35) {
      const progress = (pathsValue - 20) / 15 // 0 to 1
      const isTrianglePhase = progress < 0.5
      
      const drawShapeSegment = (startPos: THREE.Vector3, endPos: THREE.Vector3, segProgress: number) => {
        if (segProgress <= 0) return
        
        const headPos = new THREE.Vector3().lerpVectors(startPos, endPos, Math.min(1, segProgress))
        const trailSegments = 15
        const trailPositions: number[] = []
        const trailColors: number[] = []
        
        for (let j = 0; j <= trailSegments; j++) {
          const t = j / trailSegments
          const segPos = new THREE.Vector3().lerpVectors(startPos, headPos, t)
          trailPositions.push(segPos.x, segPos.y, segPos.z)
          const brightness = t * t * 0.9 + 0.1
          trailColors.push(brightness, brightness, brightness * 0.95)
        }
        
        const trailGeo = new THREE.BufferGeometry()
        trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3))
        trailGeo.setAttribute('color', new THREE.Float32BufferAttribute(trailColors, 3))
        const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })
        group.add(new THREE.Line(trailGeo, trailMat))
        
        if (segProgress < 1) {
          const headGeo = new THREE.SphereGeometry(sphereRadius * 0.006, 8, 6)
          const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
          const headMesh = new THREE.Mesh(headGeo, headMat)
          headMesh.position.copy(headPos)
          group.add(headMesh)
        }
      }
      
      const relevantIndices = isTrianglePhase ? [0, 1, 2] : [1, 2, 3, 4]
      relevantIndices.forEach((idx) => {
        const dotGeo = new THREE.SphereGeometry(sphereRadius * 0.006, 8, 6)
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
        const dot = new THREE.Mesh(dotGeo, dotMat)
        dot.position.copy(shapePositions[idx])
        group.add(dot)
      })
      
      if (isTrianglePhase) {
        const triangleVerts = [shapePositions[0], shapePositions[1], shapePositions[2], shapePositions[0]]
        const shapeProgress = progress * 2
        const totalEdges = triangleVerts.length - 1
        for (let i = 0; i < totalEdges; i++) {
          const edgeStart = i / totalEdges
          const edgeEnd = (i + 1) / totalEdges
          const edgeProgress = Math.max(0, Math.min(1, (shapeProgress - edgeStart) / (edgeEnd - edgeStart)))
          drawShapeSegment(triangleVerts[i], triangleVerts[i + 1], edgeProgress)
        }
      } else {
        const squareVerts = [shapePositions[1], shapePositions[2], shapePositions[3], shapePositions[4], shapePositions[1]]
        const shapeProgress = (progress - 0.5) * 2
        const totalEdges = squareVerts.length - 1
        for (let i = 0; i < totalEdges; i++) {
          const edgeStart = i / totalEdges
          const edgeEnd = (i + 1) / totalEdges
          const edgeProgress = Math.max(0, Math.min(1, (shapeProgress - edgeStart) / (edgeEnd - edgeStart)))
          drawShapeSegment(squareVerts[i], squareVerts[i + 1], edgeProgress)
        }
      }
    }
    
    // Phase 4: Faint lines connecting neighboring points - hint at infinite paths (35-50%)
    else if (pathsValue <= 50) {
      const progress = (pathsValue - 35) / 15 // 0 to 1
      
      // Show completed shapes fading
      const shapeFade = Math.max(0, 1 - progress * 2)
      
      // Draw fading shapes
      if (shapeFade > 0.01) {
        const triangleVerts = [shapePositions[0], shapePositions[1], shapePositions[2], shapePositions[0]]
        const squareVerts = [shapePositions[1], shapePositions[2], shapePositions[3], shapePositions[4], shapePositions[1]]
        
        const drawFadingLine = (start: THREE.Vector3, end: THREE.Vector3, opacity: number) => {
          const positions = [start.x, start.y, start.z, end.x, end.y, end.z]
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
          const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity })
          group.add(new THREE.Line(geo, mat))
        }
        
        for (let i = 0; i < triangleVerts.length - 1; i++) {
          drawFadingLine(triangleVerts[i], triangleVerts[i + 1], shapeFade * 0.6)
        }
        for (let i = 0; i < squareVerts.length - 1; i++) {
          drawFadingLine(squareVerts[i], squareVerts[i + 1], shapeFade * 0.6)
        }
      }
      
      // Cull to ~1000 stars closest to center for the network
      const maxNetworkStars = 1000
      const center = new THREE.Vector3(0, 0, 0)
      const sortedByDistance = [...stars].sort((a, b) => a.distanceTo(center) - b.distanceTo(center))
      const networkStars = sortedByDistance.slice(0, maxNetworkStars)
      const unusedStars = sortedByDistance.slice(maxNetworkStars) // Stars NOT in network
      
      // Dissolve unused stars as progress increases
      const unusedOpacity = Math.max(0, 1 - progress * 2) // Fully dissolved by 50% of phase
      if (unusedStars.length > 0 && unusedOpacity > 0.01) {
        const unusedPositions: number[] = []
        for (const star of unusedStars) {
          unusedPositions.push(star.x, star.y, star.z)
        }
        const unusedGeo = new THREE.BufferGeometry()
        unusedGeo.setAttribute('position', new THREE.Float32BufferAttribute(unusedPositions, 3))
        const unusedMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: sphereRadius * 0.01 * (1 - progress), // Shrink as they dissolve
          transparent: true,
          opacity: unusedOpacity * 0.6,
          sizeAttenuation: true
        })
        group.add(new THREE.Points(unusedGeo, unusedMat))
      }
      
      if (networkStars.length > 0) {
        // Find nearest 3 neighbors for each star (build true dense network)
        const findNearest3 = (starIdx: number): number[] => {
          const distances: { idx: number, dist: number }[] = []
          for (let j = 0; j < networkStars.length; j++) {
            if (j === starIdx) continue
            const dist = networkStars[starIdx].distanceTo(networkStars[j])
            distances.push({ idx: j, dist })
          }
          distances.sort((a, b) => a.dist - b.dist)
          return distances.slice(0, 3).map(d => d.idx)
        }
        
        // Build unique connection pairs (each star to nearest 3)
        const connectionSet = new Set<string>()
        const connections: { a: number, b: number }[] = []
        
        for (let i = 0; i < networkStars.length; i++) {
          const nearest = findNearest3(i)
          for (const j of nearest) {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`
            if (!connectionSet.has(key)) {
              connectionSet.add(key)
              connections.push({ a: i, b: j })
            }
          }
        }
        
        // Draw ALL connections with progressive reveal
        const lineOpacity = Math.min(0.4, progress * 0.6)
        const visibleConnections = Math.floor(connections.length * Math.min(1, progress * 1.5))
        
        // Use LineSegments for better performance with many lines
        const linePositions: number[] = []
        for (let i = 0; i < visibleConnections; i++) {
          const conn = connections[i]
          const starA = networkStars[conn.a]
          const starB = networkStars[conn.b]
          linePositions.push(starA.x, starA.y, starA.z, starB.x, starB.y, starB.z)
        }
        
        if (linePositions.length > 0) {
          const lineGeo = new THREE.BufferGeometry()
          lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
          const lineMat = new THREE.LineBasicMaterial({ 
            color: 0xaaaaaa, 
            transparent: true, 
            opacity: lineOpacity
          })
          group.add(new THREE.LineSegments(lineGeo, lineMat))
        }
        
        // Show network stars as points
        const starPositions: number[] = []
        for (const star of networkStars) {
          starPositions.push(star.x, star.y, star.z)
        }
        const starGeo = new THREE.BufferGeometry()
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
        const starMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: sphereRadius * 0.012,
          transparent: true,
          opacity: 0.9,
          sizeAttenuation: true
        })
        group.add(new THREE.Points(starGeo, starMat))
      }
    }
    
    // Phase 5: Zoom in, entire star network contracts toward focus star (50-65%)
    else if (pathsValue <= 65) {
      const progress = (pathsValue - 50) / 15 // 0 to 1
      
      // Focus star at sculpture centroid - this is the star we zoom into
      const focusStarPos = pathCenter.clone()
      
      // Cull to ~1000 stars closest to sculpture centroid for the network
      const maxNetworkStars = 1000
      const sortedByDistance = [...stars].sort((a, b) => a.distanceTo(pathCenter) - b.distanceTo(pathCenter))
      const networkStars = sortedByDistance.slice(0, maxNetworkStars)
      
      if (networkStars.length > 0) {
        // Find nearest 3 neighbors for each star
        const findNearest3 = (starIdx: number): number[] => {
          const distances: { idx: number, dist: number }[] = []
          for (let j = 0; j < networkStars.length; j++) {
            if (j === starIdx) continue
            const dist = networkStars[starIdx].distanceTo(networkStars[j])
            distances.push({ idx: j, dist })
          }
          distances.sort((a, b) => a.dist - b.dist)
          return distances.slice(0, 3).map(d => d.idx)
        }
        
        // Build connection pairs
        const connectionSet = new Set<string>()
        const connections: { a: number, b: number }[] = []
        
        for (let i = 0; i < networkStars.length; i++) {
          const nearest = findNearest3(i)
          for (const j of nearest) {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`
            if (!connectionSet.has(key)) {
              connectionSet.add(key)
              connections.push({ a: i, b: j })
            }
          }
        }
        
        // Focus star size - starts small, grows as network contracts into it
        const focusStarSize = sphereRadius * 0.01 * (1 + progress * 8)
        
        // Contract entire network toward focus star
        // At progress=1, network should be the size of the focus star
        const contractFactor = 1 - progress * 0.99 // Contract to 1% of original size
        const networkScale = Math.max(focusStarSize / sphereRadius, contractFactor)
        
        // Draw contracted stars as points
        const contractedPositions: THREE.Vector3[] = networkStars.map(star => {
          return star.clone().multiplyScalar(networkScale)
        })
        
        const starPositions: number[] = []
        for (const pos of contractedPositions) {
          starPositions.push(pos.x, pos.y, pos.z)
        }
        
        const starGeo = new THREE.BufferGeometry()
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
        const starMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: sphereRadius * 0.008 * (1 - progress * 0.7),
          transparent: true,
          opacity: (1 - progress * 0.8) * 0.9,
          sizeAttenuation: true
        })
        group.add(new THREE.Points(starGeo, starMat))
        
        // Draw contracted connection lines using LineSegments for performance
        const lineOpacity = (1 - progress * 0.9) * 0.4
        if (lineOpacity > 0.01) {
          const linePositions: number[] = []
          for (const conn of connections) {
            const posA = contractedPositions[conn.a]
            const posB = contractedPositions[conn.b]
            linePositions.push(posA.x, posA.y, posA.z, posB.x, posB.y, posB.z)
          }
          
          if (linePositions.length > 0) {
            const lineGeo = new THREE.BufferGeometry()
            lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
            const lineMat = new THREE.LineBasicMaterial({ 
              color: 0x888888, 
              transparent: true, 
              opacity: lineOpacity
            })
            group.add(new THREE.LineSegments(lineGeo, lineMat))
          }
        }
      }
      
      // Focus star - true sphere with sculpture material
      const focusStarSize = sphereRadius * 0.01 * (1 + progress * 8)
      const focusGeo = new THREE.SphereGeometry(focusStarSize, 64, 48)
      const focusMat = materialController.getMaterial().clone()
      focusMat.transparent = true
      focusMat.opacity = 0.5 + progress * 0.5
      const focusMesh = new THREE.Mesh(focusGeo, focusMat)
      focusMesh.position.copy(focusStarPos)
      group.add(focusMesh)
    }
    
    // Phase 6: Flash as we penetrate the star (65-70%) - clear everything, flash to white
    else if (pathsValue <= 70) {
      const progress = (pathsValue - 65) / 5 // 0 to 1
      
      // Hide all scene objects
      scene.children.forEach(child => {
        if (child.name !== 'PATHS_GROUP') {
          child.visible = false
          child.traverse((obj) => { (obj as THREE.Object3D).visible = false })
        }
      })
      
      // Flash: fade scene background from dark to white
      const bgColor = new THREE.Color(0x0a0a0a).lerp(new THREE.Color(0xffffff), progress)
      scene.background = bgColor
    }
    
    // Phase 7+: Pure white background with tiny speck that grows into lattice (70-100%)
    else {
      const progress = (pathsValue - 70) / 30 // 0 to 1 over full range
      
      // Hide all scene objects
      scene.children.forEach(child => {
        if (child.name !== 'PATHS_GROUP') {
          child.visible = false
          child.traverse((obj) => { (obj as THREE.Object3D).visible = false })
        }
      })
      
      // Pure white background - no sphere needed, just scene.background
      scene.background = new THREE.Color(0xffffff)
      
      // Lattice scales slowly from tiny to full size (70-100%)
      // Generate lattice points - 1.5x sculpture bounding sphere
      const sculptRadius = sculptureRadiusRef.current
      const latticeRadius = sculptRadius * 1.5
      const allLatticePoints = latticePointsRef.current
      const visibleLatticePoints = allLatticePoints.filter(p => p.distanceTo(pathCenter) < latticeRadius)
      
      // Lattice scale: starts very small, grows slowly to full size
      const latticeScale = 0.001 + progress * 0.999
      const latticeOpacity = Math.min(1, progress * 3) // Fade in quickly
      
      // Sphere size at lattice points
      const maxSphereRadius = latticeConstant * 0.12
      const nodeSphereSize = maxSphereRadius * latticeScale
      
      // Draw lattice spheres
      if (visibleLatticePoints.length > 0 && nodeSphereSize > 0.0001) {
        const sphereGeo = new THREE.SphereGeometry(nodeSphereSize, 16, 12)
        const sphereMat = materialController.getMaterial().clone()
        sphereMat.transparent = true
        sphereMat.opacity = latticeOpacity
        
        const sphereMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, visibleLatticePoints.length)
        const dummy = new THREE.Object3D()
        
        visibleLatticePoints.forEach((p, i) => {
          // Scale positions from center
          const scaledPos = p.clone().sub(pathCenter).multiplyScalar(latticeScale).add(pathCenter)
          dummy.position.copy(scaledPos)
          dummy.updateMatrix()
          sphereMesh.setMatrixAt(i, dummy.matrix)
        })
        sphereMesh.instanceMatrix.needsUpdate = true
        group.add(sphereMesh)
        
        // Draw bonds between neighbors (sticks at 15% of sphere diameter)
        if (progress > 0.2) {
          const bondPairs: { start: THREE.Vector3, end: THREE.Vector3 }[] = []
          // FCC nearest neighbor distance: only bonds at exactly latticeConstant (with tiny tolerance)
          const neighborDist = latticeConstant * 1.02
          
          for (let i = 0; i < visibleLatticePoints.length; i++) {
            for (let j = i + 1; j < visibleLatticePoints.length; j++) {
              const dist = visibleLatticePoints[i].distanceTo(visibleLatticePoints[j])
              if (dist < neighborDist) {
                const startScaled = visibleLatticePoints[i].clone().sub(pathCenter).multiplyScalar(latticeScale).add(pathCenter)
                const endScaled = visibleLatticePoints[j].clone().sub(pathCenter).multiplyScalar(latticeScale).add(pathCenter)
                bondPairs.push({ start: startScaled, end: endScaled })
              }
            }
          }
          
          if (bondPairs.length > 0) {
            const tubeRadius = nodeSphereSize * 0.15
            const tubeGeo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, 1, 8, 1)
            tubeGeo.rotateX(Math.PI / 2)
            
            const bondOpacity = Math.min(1, (progress - 0.2) * 1.5)
            const tubeMat = materialController.getMaterial().clone()
            tubeMat.transparent = true
            tubeMat.opacity = bondOpacity
            
            const tubeMesh = new THREE.InstancedMesh(tubeGeo, tubeMat, bondPairs.length)
            const matrix = new THREE.Matrix4()
            const position = new THREE.Vector3()
            const quaternion = new THREE.Quaternion()
            const scale = new THREE.Vector3()
            const up = new THREE.Vector3(0, 0, 1)
            
            bondPairs.forEach((bond, i) => {
              position.lerpVectors(bond.start, bond.end, 0.5)
              const direction = new THREE.Vector3().subVectors(bond.end, bond.start)
              const length = direction.length()
              direction.normalize()
              quaternion.setFromUnitVectors(up, direction)
              scale.set(1, 1, length)
              matrix.compose(position, quaternion, scale)
              tubeMesh.setMatrixAt(i, matrix)
            })
            tubeMesh.instanceMatrix.needsUpdate = true
            group.add(tubeMesh)
          }
        }
      }
    }
    
    scene.add(group)
    pathsGroupRef.current = group
  }, [pathsValue, showPaths, scene])

  // Structure effect - lattice formation from stars
  const structureGroupRef = useRef<THREE.Group | null>(null)
  const structureNodesRef = useRef<{ star: THREE.Vector3, target: THREE.Vector3, current: THREE.Vector3 }[]>([])
  
  useEffect(() => {
    // Cleanup existing structure
    if (structureGroupRef.current) {
      scene.remove(structureGroupRef.current)
      structureGroupRef.current.traverse((obj) => {
        if (obj instanceof THREE.Points || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose())
          } else {
            (obj.material as THREE.Material).dispose()
          }
        }
      })
      structureGroupRef.current = null
    }
    structureNodesRef.current = []
    
    if (!showStructure || structureValue === 0 || showCurved) return
    
    const group = new THREE.Group()
    group.name = 'STRUCTURE_GROUP'
    
    // Calculate sculpture path centroid
    const pathCorners = sculpturePathRef.current
    const pathCenter = new THREE.Vector3()
    if (pathCorners.length > 0) {
      pathCorners.forEach(p => pathCenter.add(p))
      pathCenter.divideScalar(pathCorners.length)
    }
    
    // Filter lattice points to 2x sculpture spherical volume, centered on sculpture path
    const sculptureRadius = sculptureRadiusRef.current
    const latticeRadius = sculptureRadius * 2
    const allLatticePoints = latticePointsRef.current
    const latticePoints = allLatticePoints.filter(p => p.distanceTo(pathCenter) < latticeRadius)
    
    const starPositions = galaxyStarPositionsRef.current
    const latticeType = latticeTypeRef.current
    const latticeConstant = latticeConstantRef.current
    
    console.info(`[Structure] latticePoints=${latticePoints.length}, starPositions=${starPositions.length}, latticeConstant=${latticeConstant.toFixed(3)}, latticeType=${latticeType}`)
    
    if (latticePoints.length === 0 || starPositions.length === 0) return
    
    // Phase 1 (0-25%): Show bonds, fade unused stars
    // Phase 2 (25-50%): Continue fading, show lattice bonds
    // Phase 3 (50-90%): Pull toward lattice
    // Phase 4 (90-100%): Final form with spheres
    
    // Select stars closest to each lattice point
    const selectedStars: { star: THREE.Vector3, target: THREE.Vector3 }[] = []
    const usedStarIndices = new Set<number>()
    
    for (const latticePoint of latticePoints) {
      let closestIdx = -1
      let closestDist = Infinity
      for (let i = 0; i < starPositions.length; i++) {
        if (usedStarIndices.has(i)) continue
        const dist = starPositions[i].distanceTo(latticePoint)
        if (dist < closestDist) {
          closestDist = dist
          closestIdx = i
        }
      }
      if (closestIdx >= 0) {
        usedStarIndices.add(closestIdx)
        selectedStars.push({ star: starPositions[closestIdx].clone(), target: latticePoint.clone() })
      }
    }
    
    // Calculate interpolation based on slider phase
    let pullProgress = 0
    
    // Scale sphere size relative to lattice constant for proper proportions
    const maxSphereRadius = latticeConstant * 0.12 // 80% of 0.15
    let sphereRadiusFactor = 0 // Start invisible
    let pathTubeFactor = 0 // Sculpture path tube growth factor
    
    if (structureValue <= 25) {
      // Phase 1: Show bold sculpture path growing to full diameter
      const p = structureValue / 25
      pathTubeFactor = p // Path grows to full size
      pullProgress = 0
      sphereRadiusFactor = 0 // Spheres not visible yet
    } else if (structureValue <= 50) {
      // Phase 2: Path at full size, start showing lattice spheres
      const p = (structureValue - 25) / 25
      pathTubeFactor = 1 // Path stays at full size
      pullProgress = 0
      sphereRadiusFactor = p * 0.3 // Spheres fade in to 30%
    } else if (structureValue <= 90) {
      // Phase 3: Pull stars toward lattice positions
      const p = (structureValue - 50) / 40
      pathTubeFactor = 1
      pullProgress = p * p // Ease-in pull
      sphereRadiusFactor = 0.3 + p * 0.7 // Grow to 100%
    } else {
      // Phase 4: Final form
      pathTubeFactor = 1
      pullProgress = 1
      sphereRadiusFactor = 1.0 // Full size
    }
    
    const sphereRadius = maxSphereRadius * sphereRadiusFactor
    
    // Create current positions based on pull progress
    const currentPositions: THREE.Vector3[] = selectedStars.map(s => {
      const current = new THREE.Vector3().lerpVectors(s.star, s.target, pullProgress)
      structureNodesRef.current.push({ star: s.star, target: s.target, current })
      return current
    })
    
    // Draw non-selected stars (fading out) - completely gone by 80% of slider
    const fadeProgress = Math.min(1, structureValue / 80) // Fully faded by 80%
    const adjustedNonNodeOpacity = Math.max(0, 1 - fadeProgress)
    
    if (adjustedNonNodeOpacity > 0.01) {
      const nonSelectedPositions: number[] = []
      for (let i = 0; i < starPositions.length; i++) {
        if (!usedStarIndices.has(i)) {
          nonSelectedPositions.push(starPositions[i].x, starPositions[i].y, starPositions[i].z)
        }
      }
      if (nonSelectedPositions.length > 0) {
        const nonSelectedGeo = new THREE.BufferGeometry()
        nonSelectedGeo.setAttribute('position', new THREE.Float32BufferAttribute(nonSelectedPositions, 3))
        const nonSelectedMat = new THREE.PointsMaterial({ color: 0x666666, size: 0.3, transparent: true, opacity: adjustedNonNodeOpacity })
        group.add(new THREE.Points(nonSelectedGeo, nonSelectedMat))
      }
    }
    
    // Draw lattice nodes as spheres using InstancedMesh with sculpture material (fully opaque)
    if (currentPositions.length > 0 && sphereRadiusFactor > 0.01) {
      const sphereGeo = new THREE.SphereGeometry(sphereRadius, 16, 12)
      const sphereMat = materialController.getMaterial().clone()
      sphereMat.transparent = false
      sphereMat.opacity = 1
      const sphereMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, currentPositions.length)
      sphereMesh.name = 'LATTICE_SPHERES'
      
      const dummy = new THREE.Object3D()
      currentPositions.forEach((p, i) => {
        dummy.position.copy(p)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        sphereMesh.setMatrixAt(i, dummy.matrix)
      })
      sphereMesh.instanceMatrix.needsUpdate = true
      group.add(sphereMesh)
    }
    
    // Draw bonds between FCC lattice neighbors as tubes (only after phase 1)
    // Use TARGET (lattice) positions to determine neighbors, draw at CURRENT positions
    if (selectedStars.length > 1 && sphereRadiusFactor > 0.01) {
      const bondPairs: { start: THREE.Vector3, end: THREE.Vector3 }[] = []
      
      // FCC nearest neighbor distance: only bonds at exactly latticeConstant (with tiny tolerance)
      const neighborDist = latticeConstant * 1.02
      console.info(`[Structure] latticeConstant=${latticeConstant.toFixed(3)}, neighborDist=${neighborDist.toFixed(3)}, selectedStars=${selectedStars.length}`)
      
      // Check neighbor relationships using TARGET (lattice) positions
      for (let i = 0; i < selectedStars.length; i++) {
        for (let j = i + 1; j < selectedStars.length; j++) {
          const targetDist = selectedStars[i].target.distanceTo(selectedStars[j].target)
          if (targetDist < neighborDist) {
            // Draw bond at CURRENT (interpolated) positions
            bondPairs.push({ start: currentPositions[i], end: currentPositions[j] })
          }
        }
      }
      
      console.info(`[Structure] Drawing ${bondPairs.length} bonds, sphereRadius=${sphereRadius.toFixed(3)}, neighborDist=${neighborDist.toFixed(3)}`)
      
      if (bondPairs.length > 0) {
        const tubeRadius = sphereRadius * 0.16 // 80% of 0.2 (20% of sphere radius)
        const tubeGeo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, 1, 8, 1)
        tubeGeo.rotateX(Math.PI / 2)
        
        const tubeMat = materialController.getMaterial().clone()
        tubeMat.transparent = false
        tubeMat.opacity = 1
        const tubeMesh = new THREE.InstancedMesh(tubeGeo, tubeMat, bondPairs.length)
        tubeMesh.name = 'LATTICE_BONDS'
        
        const matrix = new THREE.Matrix4()
        const position = new THREE.Vector3()
        const quaternion = new THREE.Quaternion()
        const scale = new THREE.Vector3()
        const up = new THREE.Vector3(0, 0, 1)
        
        bondPairs.forEach((bond, i) => {
          position.lerpVectors(bond.start, bond.end, 0.5)
          
          const direction = new THREE.Vector3().subVectors(bond.end, bond.start)
          const length = direction.length()
          direction.normalize()
          
          quaternion.setFromUnitVectors(up, direction)
          scale.set(1, 1, length)
          
          matrix.compose(position, quaternion, scale)
          tubeMesh.setMatrixAt(i, matrix)
        })
        tubeMesh.instanceMatrix.needsUpdate = true
        group.add(tubeMesh)
      }
    }
    
    // Draw sculpture path as tubes (growing over slider duration)
    if (sculpturePathRef.current.length >= 2) {
      const pathCorners = sculpturePathRef.current
      const pathSegments: { start: THREE.Vector3, end: THREE.Vector3 }[] = []
      
      // Create segments connecting consecutive corners (closed loop)
      for (let i = 0; i < pathCorners.length; i++) {
        const next = (i + 1) % pathCorners.length
        pathSegments.push({ start: pathCorners[i], end: pathCorners[next] })
      }
      
      if (pathSegments.length > 0 && pathTubeFactor > 0.01) {
        // Path tube radius = 2x final bond tube radius, growing with pathTubeFactor
        const finalBondTubeRadius = maxSphereRadius * 0.16
        const pathTubeRadius = finalBondTubeRadius * 2 * pathTubeFactor
        
        console.info(`[Structure] Path tubes: pathTubeFactor=${pathTubeFactor.toFixed(2)}, pathRadius=${pathTubeRadius.toFixed(4)}, segments=${pathSegments.length}`)
        
        const pathTubeGeo = new THREE.CylinderGeometry(pathTubeRadius, pathTubeRadius, 1, 8, 1)
        pathTubeGeo.rotateX(Math.PI / 2)
        
        // Red material for debugging
        const pathTubeMat = new THREE.MeshStandardMaterial({ 
          color: 0xff0000, 
          transparent: false, 
          opacity: 1,
          metalness: 0.3,
          roughness: 0.7
        })
        const pathTubeMesh = new THREE.InstancedMesh(pathTubeGeo, pathTubeMat, pathSegments.length)
        pathTubeMesh.name = 'SCULPTURE_PATH_TUBES'
        
        const matrix = new THREE.Matrix4()
        const position = new THREE.Vector3()
        const quaternion = new THREE.Quaternion()
        const scale = new THREE.Vector3()
        const up = new THREE.Vector3(0, 0, 1)
        
        pathSegments.forEach((seg, i) => {
          position.lerpVectors(seg.start, seg.end, 0.5)
          
          const direction = new THREE.Vector3().subVectors(seg.end, seg.start)
          const length = direction.length()
          direction.normalize()
          
          quaternion.setFromUnitVectors(up, direction)
          scale.set(1, 1, length)
          
          matrix.compose(position, quaternion, scale)
          pathTubeMesh.setMatrixAt(i, matrix)
        })
        pathTubeMesh.instanceMatrix.needsUpdate = true
        group.add(pathTubeMesh)
        
        // Add red corner spheres at each path corner
        const cornerSphereRadius = pathTubeRadius * 2 // 2x tube diameter
        const cornerSphereGeo = new THREE.SphereGeometry(cornerSphereRadius, 16, 12)
        const cornerSphereMat = new THREE.MeshStandardMaterial({ 
          color: 0xff0000, 
          transparent: false, 
          opacity: 1,
          metalness: 0.3,
          roughness: 0.7
        })
        const cornerSphereMesh = new THREE.InstancedMesh(cornerSphereGeo, cornerSphereMat, pathCorners.length)
        cornerSphereMesh.name = 'PATH_CORNER_SPHERES'
        
        const dummy = new THREE.Object3D()
        pathCorners.forEach((corner, i) => {
          dummy.position.copy(corner)
          dummy.scale.setScalar(1)
          dummy.updateMatrix()
          cornerSphereMesh.setMatrixAt(i, dummy.matrix)
        })
        cornerSphereMesh.instanceMatrix.needsUpdate = true
        group.add(cornerSphereMesh)
      }
    }
    
    scene.add(group)
    structureGroupRef.current = group
  }, [structureValue, showStructure, showCurved, scene])

  // Curved effect - dissolve lattice spheres and bonds
  const curvedGroupRef = useRef<THREE.Group | null>(null)
  
  useEffect(() => {
    // Cleanup previous curved group
    if (curvedGroupRef.current) {
      curvedGroupRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose())
          } else {
            obj.material.dispose()
          }
        }
      })
      scene.remove(curvedGroupRef.current)
      curvedGroupRef.current = null
    }
    
    if (!showCurved) return
    
    const group = new THREE.Group()
    group.name = 'CURVED_GROUP'
    
    const latticeConstant = latticeConstantRef.current
    const maxSphereRadius = latticeConstant * 0.12
    const pathCorners = sculpturePathRef.current
    
    // Get the structure's final state data
    const sculptureRadius = sculptureRadiusRef.current
    const latticeRadius = sculptureRadius * 2
    const allLatticePoints = latticePointsRef.current
    const starPositions = galaxyStarPositionsRef.current
    
    // Calculate path center
    const pathCenter = new THREE.Vector3()
    if (pathCorners.length > 0) {
      pathCorners.forEach(p => pathCenter.add(p))
      pathCenter.divideScalar(pathCorners.length)
    }
    
    const latticePoints = allLatticePoints.filter(p => p.distanceTo(pathCenter) < latticeRadius)
    
    if (latticePoints.length === 0 || starPositions.length === 0) return
    
    // Calculate dissolution progress (0 = full lattice, 50% = fully dissolved)
    // Lattice dissolves over 0-50%, curving happens 50-100%
    const dissolveProgress = Math.min(1, curvedValue / 50)
    const sphereOpacity = Math.max(0, 1 - dissolveProgress)
    const sphereScale = Math.max(0.01, 1 - dissolveProgress * 0.9) // Shrink as dissolving
    
    // Select stars closest to each lattice point (same as Structure)
    const selectedStars: { star: THREE.Vector3, target: THREE.Vector3 }[] = []
    const usedStarIndices = new Set<number>()
    
    for (const latticePoint of latticePoints) {
      let closestIdx = -1
      let closestDist = Infinity
      for (let i = 0; i < starPositions.length; i++) {
        if (usedStarIndices.has(i)) continue
        const dist = starPositions[i].distanceTo(latticePoint)
        if (dist < closestDist) {
          closestDist = dist
          closestIdx = i
        }
      }
      if (closestIdx >= 0) {
        usedStarIndices.add(closestIdx)
        selectedStars.push({ star: starPositions[closestIdx].clone(), target: latticePoint.clone() })
      }
    }
    
    // Draw dissolving lattice spheres
    if (selectedStars.length > 0 && sphereOpacity > 0.01) {
      const sphereRadius = maxSphereRadius * sphereScale
      const sphereGeo = new THREE.SphereGeometry(sphereRadius, 16, 12)
      const sphereMat = materialController.getMaterial().clone()
      sphereMat.transparent = true
      sphereMat.opacity = sphereOpacity
      const sphereMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, selectedStars.length)
      sphereMesh.name = 'DISSOLVING_SPHERES'
      
      const dummy = new THREE.Object3D()
      selectedStars.forEach((s, i) => {
        dummy.position.copy(s.target) // Use final lattice position
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        sphereMesh.setMatrixAt(i, dummy.matrix)
      })
      sphereMesh.instanceMatrix.needsUpdate = true
      group.add(sphereMesh)
    }
    
    // Draw dissolving bonds
    if (selectedStars.length > 1 && sphereOpacity > 0.01) {
      const bondPairs: { start: THREE.Vector3, end: THREE.Vector3 }[] = []
      // FCC nearest neighbor distance: only bonds at exactly latticeConstant (with tiny tolerance)
      const neighborDist = latticeConstant * 1.02
      
      for (let i = 0; i < selectedStars.length; i++) {
        for (let j = i + 1; j < selectedStars.length; j++) {
          const targetDist = selectedStars[i].target.distanceTo(selectedStars[j].target)
          if (targetDist < neighborDist) {
            bondPairs.push({ start: selectedStars[i].target, end: selectedStars[j].target })
          }
        }
      }
      
      if (bondPairs.length > 0) {
        const tubeRadius = maxSphereRadius * 0.16 * sphereScale
        const tubeGeo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, 1, 8, 1)
        tubeGeo.rotateX(Math.PI / 2)
        
        const tubeMat = materialController.getMaterial().clone()
        tubeMat.transparent = true
        tubeMat.opacity = sphereOpacity
        const tubeMesh = new THREE.InstancedMesh(tubeGeo, tubeMat, bondPairs.length)
        tubeMesh.name = 'DISSOLVING_BONDS'
        
        const matrix = new THREE.Matrix4()
        const position = new THREE.Vector3()
        const quaternion = new THREE.Quaternion()
        const scale = new THREE.Vector3()
        const up = new THREE.Vector3(0, 0, 1)
        
        bondPairs.forEach((bond, i) => {
          position.lerpVectors(bond.start, bond.end, 0.5)
          const direction = new THREE.Vector3().subVectors(bond.end, bond.start)
          const length = direction.length()
          direction.normalize()
          quaternion.setFromUnitVectors(up, direction)
          scale.set(1, 1, length)
          matrix.compose(position, quaternion, scale)
          tubeMesh.setMatrixAt(i, matrix)
        })
        tubeMesh.instanceMatrix.needsUpdate = true
        group.add(tubeMesh)
      }
    }
    
    // Sculpture path: smoothly deform from straight polyline to curved tube
    if (pathCorners.length >= 2) {
      const finalBondTubeRadius = maxSphereRadius * 0.16
      const pathTubeRadius = finalBondTubeRadius * 2
      
      // Calculate curve interpolation factor (0 = straight, 1 = fully curved)
      // This happens after lattice dissolves (50-100% of slider)
      const curveProgress = Math.max(0, Math.min(1, (curvedValue - 50) / 50))
      
      const pathTubeMat = new THREE.MeshStandardMaterial({ 
        color: 0xff0000, 
        transparent: false, 
        opacity: 1,
        metalness: 0.3,
        roughness: 0.7
      })
      
      // Use sculptureCurve from OBJ file as morph target
      const sculptureCurve = sculptureCurveRef.current
      
      // Number of samples for the tube
      const totalSamples = pathCorners.length * 16
      const interpolatedPoints: THREE.Vector3[] = []
      
      if (sculptureCurve.length >= 2 && curveProgress > 0) {
        // Create curve from the actual sculpture curve points (closed loop)
        const targetCurve = new THREE.CatmullRomCurve3(sculptureCurve, true, 'catmullrom', 0.5)
        
        // Find the t value on the curve closest to the first polyline corner
        const firstCorner = pathCorners[0]
        let bestT = 0
        let bestDist = Infinity
        for (let i = 0; i <= 100; i++) {
          const t = i / 100
          const pt = targetCurve.getPoint(t)
          const dist = pt.distanceTo(firstCorner)
          if (dist < bestDist) {
            bestDist = dist
            bestT = t
          }
        }
        
        // Check direction: compare second corner to curve direction
        const secondCorner = pathCorners[1]
        const curveSlightlyAhead = targetCurve.getPoint((bestT + 0.05) % 1)
        const curveSlightlyBehind = targetCurve.getPoint((bestT + 0.95) % 1)
        
        const distAhead = curveSlightlyAhead.distanceTo(secondCorner)
        const distBehind = curveSlightlyBehind.distanceTo(secondCorner)
        const reverseDirection = distBehind < distAhead
        
        // Sample points along both straight polyline and target curve, then interpolate
        for (let i = 0; i < totalSamples; i++) {
          const t = i / totalSamples // 0 to 1 around the path
          
          // Get point on target sculpture curve (offset by bestT and possibly reversed)
          let curveT = reverseDirection ? (bestT - t + 1) % 1 : (bestT + t) % 1
          const curvedPoint = targetCurve.getPoint(curveT)
          
          // Get point on straight polyline (exact polyline geometry)
          const segmentFloat = t * pathCorners.length
          const segmentIndex = Math.floor(segmentFloat) % pathCorners.length
          const segmentT = segmentFloat - Math.floor(segmentFloat)
          const nextIndex = (segmentIndex + 1) % pathCorners.length
          const straightPoint = new THREE.Vector3().lerpVectors(
            pathCorners[segmentIndex], 
            pathCorners[nextIndex], 
            segmentT
          )
          
          // Interpolate between straight polyline and sculpture curve based on progress
          const interpolatedPoint = new THREE.Vector3().lerpVectors(
            straightPoint, 
            curvedPoint, 
            curveProgress
          )
          interpolatedPoints.push(interpolatedPoint)
        }
      } else {
        // curveProgress=0: show exact straight polyline
        for (let i = 0; i < totalSamples; i++) {
          const t = i / totalSamples
          const segmentFloat = t * pathCorners.length
          const segmentIndex = Math.floor(segmentFloat) % pathCorners.length
          const segmentT = segmentFloat - Math.floor(segmentFloat)
          const nextIndex = (segmentIndex + 1) % pathCorners.length
          const straightPoint = new THREE.Vector3().lerpVectors(
            pathCorners[segmentIndex], 
            pathCorners[nextIndex], 
            segmentT
          )
          interpolatedPoints.push(straightPoint)
        }
      }
      
      // Create tube through the points (use tension=0 for polyline look when straight)
      if (interpolatedPoints.length >= 2) {
        const tension = curveProgress * 0.5 // 0 tension at start (angular), 0.5 at end (smooth)
        const interpCurve = new THREE.CatmullRomCurve3(interpolatedPoints, true, 'catmullrom', tension)
        const tubeGeo = new THREE.TubeGeometry(interpCurve, totalSamples, pathTubeRadius, 8, true)
        const tubeMesh = new THREE.Mesh(tubeGeo, pathTubeMat)
        tubeMesh.name = 'SCULPTURE_PATH_MORPHING'
        group.add(tubeMesh)
      }
      
      // Corner spheres shrink as curve forms (they become unnecessary)
      if (curveProgress < 1) {
        const cornerSphereRadius = pathTubeRadius * 2 * (1 - curveProgress)
        if (cornerSphereRadius > 0.001) {
          const cornerSphereGeo = new THREE.SphereGeometry(cornerSphereRadius, 16, 12)
          const cornerSphereMesh = new THREE.InstancedMesh(cornerSphereGeo, pathTubeMat, pathCorners.length)
          cornerSphereMesh.name = 'PATH_CORNER_SPHERES'
          
          const dummy = new THREE.Object3D()
          pathCorners.forEach((corner, i) => {
            dummy.position.copy(corner)
            dummy.scale.setScalar(1)
            dummy.updateMatrix()
            cornerSphereMesh.setMatrixAt(i, dummy.matrix)
          })
          cornerSphereMesh.instanceMatrix.needsUpdate = true
          group.add(cornerSphereMesh)
        }
      }
    }
    
    scene.add(group)
    curvedGroupRef.current = group
  }, [curvedValue, showCurved, showProfiled, scene])

  // Profiled effect - transform tube into lofted sculpture with cross-sections
  const profiledGroupRef = useRef<THREE.Group | null>(null)
  
  useEffect(() => {
    // Cleanup previous
    if (profiledGroupRef.current) {
      profiledGroupRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry?.dispose()
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose())
          } else if (obj.material) {
            obj.material.dispose()
          }
        }
      })
      scene.remove(profiledGroupRef.current)
      profiledGroupRef.current = null
    }
    
    if (!showProfiled) return
    
    const group = new THREE.Group()
    group.name = 'PROFILED_GROUP'
    
    const pathCorners = sculpturePathRef.current
    const sculptureCurve = sculptureCurveRef.current
    const crossSectionsGroup = crossSectionsRef.current
    
    if (pathCorners.length < 2 || sculptureCurve.length < 2) return
    
    // Get cross-section data
    const crossSectionVertices: THREE.Vector3[][] = []
    if (crossSectionsGroup) {
      crossSectionsGroup.children.forEach(child => {
        if (child instanceof THREE.LineLoop) {
          const positions = child.geometry.getAttribute('position')
          if (positions) {
            const verts: THREE.Vector3[] = []
            for (let i = 0; i < positions.count; i++) {
              verts.push(new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
              ))
            }
            crossSectionVertices.push(verts)
          }
        }
      })
    }
    
    if (crossSectionVertices.length === 0) return
    
    // Create the curve for sampling
    const curve = new THREE.CatmullRomCurve3(sculptureCurve, true, 'catmullrom', 0.5)
    
    // Calculate animation phases
    const overallProgress = profiledValue / 100
    
    // Phase 1: Color transition (0-25%) - red tube morphs to material color
    const colorProgress = Math.min(1, overallProgress / 0.25)
    
    // Phase 2: Mesh growth sweep (25-100%) - lofted mesh travels along curve with scaling head
    const meshSweepProgress = Math.max(0, Math.min(1, (overallProgress - 0.25) / 0.75))
    
    // Get sculpture material and interpolate color from red
    const sculptureMat = materialController.getMaterial()
    const redColor = new THREE.Color(0xff0000)
    const targetColor = sculptureMat.color ? sculptureMat.color.clone() : new THREE.Color(0xcccccc)
    const currentColor = redColor.clone().lerp(targetColor, colorProgress)
    
    // Interpolate material properties
    const currentMetalness = 0.3 + (sculptureMat.metalness - 0.3) * colorProgress
    const currentRoughness = 0.7 + (sculptureMat.roughness - 0.7) * colorProgress
    
    // Phase 1: Draw the curved tube with transitioning color (fades out as mesh grows)
    if (meshSweepProgress < 1) {
      const tubeOpacity = 1 - meshSweepProgress
      const latticeConstant = latticeConstantRef.current
      const maxSphereRadius = latticeConstant * 0.12
      const pathTubeRadius = maxSphereRadius * 0.16 * 2
      
      const tubeMat = new THREE.MeshStandardMaterial({
        color: currentColor,
        metalness: currentMetalness,
        roughness: currentRoughness,
        transparent: true,
        opacity: tubeOpacity
      })
      
      const tubeGeo = new THREE.TubeGeometry(curve, sculptureCurve.length * 4, pathTubeRadius, 8, true)
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat)
      tubeMesh.name = 'PROFILED_TUBE'
      group.add(tubeMesh)
    }
    
    // Phase 2: Traveling mesh with scaling growth effect
    if (meshSweepProgress > 0 && crossSectionVertices.length >= 2) {
      const numSections = crossSectionVertices.length
      
      // How far along the curve we've traveled (0 to numSections)
      const travelPosition = meshSweepProgress * numSections
      
      // Number of sections to include in the mesh
      const sectionsToInclude = Math.min(Math.ceil(travelPosition) + 1, numSections)
      
      // Build lofted geometry with scaling at the head
      const loftVertices: number[] = []
      const loftIndices: number[] = []
      
      // Taper settings as percentages of total curve length
      const tipAheadPercent = 0.12  // Tip is ~12% ahead (between 10-15%)
      const taperPercent = 0.30     // Scaling happens over 30% behind tip
      
      // Convert percentages to section counts
      const tipAheadSections = numSections * tipAheadPercent
      const taperSections = numSections * taperPercent
      
      for (let i = 0; i < sectionsToInclude; i++) {
        const sectionVerts = crossSectionVertices[i]
        if (!sectionVerts) continue
        
        // Calculate scale for this section
        // Tip is ahead of travel position, scaling happens behind tip
        // At meshSweepProgress = 1, all sections should be full size
        let sectionScale = 1
        
        if (meshSweepProgress < 1) {
          // Effective head position (tip is ahead)
          const tipPosition = travelPosition + tipAheadSections
          const distanceFromTip = tipPosition - i
          
          if (distanceFromTip < taperSections) {
            // Smooth taper from 0 at tip to 1 at taperSections behind
            sectionScale = Math.max(0, Math.min(1, distanceFromTip / taperSections))
            // Apply easing for smoother taper
            sectionScale = sectionScale * sectionScale * (3 - 2 * sectionScale) // smoothstep
          }
        }
        
        // Get section centroid
        const centroid = new THREE.Vector3()
        sectionVerts.forEach(v => centroid.add(v))
        centroid.divideScalar(sectionVerts.length)
        
        // Add scaled vertices for this section
        sectionVerts.forEach(v => {
          const offset = v.clone().sub(centroid)
          const scaled = centroid.clone().add(offset.multiplyScalar(sectionScale))
          loftVertices.push(scaled.x, scaled.y, scaled.z)
        })
      }
      
      // Create faces between adjacent sections
      const vertsPerSection = crossSectionVertices[0]?.length || 0
      for (let i = 0; i < sectionsToInclude - 1; i++) {
        const baseIdx = i * vertsPerSection
        const nextBaseIdx = (i + 1) * vertsPerSection
        
        for (let j = 0; j < vertsPerSection; j++) {
          const nextJ = (j + 1) % vertsPerSection
          
          // Two triangles per quad
          loftIndices.push(baseIdx + j, nextBaseIdx + j, nextBaseIdx + nextJ)
          loftIndices.push(baseIdx + j, nextBaseIdx + nextJ, baseIdx + nextJ)
        }
      }
      
      if (loftVertices.length > 0 && loftIndices.length > 0) {
        const loftGeo = new THREE.BufferGeometry()
        loftGeo.setAttribute('position', new THREE.Float32BufferAttribute(loftVertices, 3))
        loftGeo.setIndex(loftIndices)
        loftGeo.computeVertexNormals()
        
        // Use interpolated material for growing mesh, full material at end
        const loftMat = meshSweepProgress >= 1 
          ? sculptureMat.clone()
          : new THREE.MeshStandardMaterial({
              color: currentColor,
              metalness: currentMetalness,
              roughness: currentRoughness,
              side: THREE.DoubleSide
            })
        
        const loftMesh = new THREE.Mesh(loftGeo, loftMat)
        loftMesh.name = 'PROFILED_LOFT'
        group.add(loftMesh)
      }
    }
    
    scene.add(group)
    profiledGroupRef.current = group
  }, [profiledValue, showProfiled, scene])

  // Hide all chapter groups during Paths white phase (65%+)
  useEffect(() => {
    if (showPaths && pathsValue >= 65) {
      if (structureGroupRef.current) structureGroupRef.current.visible = false
      if (curvedGroupRef.current) curvedGroupRef.current.visible = false
      if (profiledGroupRef.current) profiledGroupRef.current.visible = false
    } else {
      if (structureGroupRef.current) structureGroupRef.current.visible = true
      if (curvedGroupRef.current) curvedGroupRef.current.visible = true
      if (profiledGroupRef.current) profiledGroupRef.current.visible = true
    }
  }, [showPaths, pathsValue])

  // Track cleanup frames after AR exit
  const arCleanupFramesRef = useRef(0)
  
  // Set cleanup frames when sceneResetTrigger changes
  useEffect(() => {
    if (sceneResetTrigger && sceneResetTrigger > 0) {
      arCleanupFramesRef.current = 10 // Cleanup for 10 frames
    }
  }, [sceneResetTrigger])
  
  useFrame((_, delta) => {
    if (controlsRef.current) controlsRef.current.update()
    
    // Shooting stars animation is now slider-driven, no frame animation needed
    
    // Animate shapes and constellations (phases 3a and 3b)
    if (showPaths && pathsValue > 40 && pathsValue <= 70 && animatedShapesRef.current.length > 0) {
      animatedShapesRef.current.forEach(shape => {
        shape.progress += delta * shape.speed * 0.1
        
        // Calculate how many segments to show based on progress
        const totalSegments = shape.points.length - 1
        const segmentsToShow = Math.floor(shape.progress * totalSegments)
        const withinSegment = (shape.progress * totalSegments) - segmentsToShow
        
        if (segmentsToShow >= totalSegments) {
          // Shape complete, restart after brief pause
          if (shape.progress > totalSegments / shape.speed + 0.5) {
            shape.progress = 0
          }
          // Show complete shape
          shape.line.geometry.dispose()
          shape.line.geometry = new THREE.BufferGeometry().setFromPoints(shape.points)
        } else if (segmentsToShow >= 0) {
          // Animate current segment
          const drawPoints: THREE.Vector3[] = []
          for (let i = 0; i <= segmentsToShow; i++) {
            drawPoints.push(shape.points[i])
          }
          // Add animated head position
          if (segmentsToShow < totalSegments) {
            const headPos = new THREE.Vector3().lerpVectors(
              shape.points[segmentsToShow],
              shape.points[segmentsToShow + 1],
              withinSegment
            )
            drawPoints.push(headPos)
          }
          
          shape.line.geometry.dispose()
          shape.line.geometry = new THREE.BufferGeometry().setFromPoints(drawPoints)
        }
        
        // Fade effect
        const material = shape.line.material as THREE.LineBasicMaterial
        material.opacity = shape.progress < 0.1 ? shape.progress * 8 : 0.8
      })
    }
    
    // Continuous AR cleanup for several frames after AR exit
    if (arCleanupFramesRef.current > 0) {
      arCleanupFramesRef.current--
      
      // Find and remove any AR objects
      const toRemove: THREE.Object3D[] = []
      scene.traverse((obj) => {
        if (obj.name?.startsWith('AR_')) {
          toRemove.push(obj)
        }
        // Also check for small-scale groups (AR parent)
        if (obj instanceof THREE.Group && obj.scale.x < 0.1 && obj.scale.x > 0 && obj.parent === scene) {
          toRemove.push(obj)
        }
      })
      
      if (toRemove.length > 0) {
        console.info(`[AR Cleanup Frame] Removing ${toRemove.length} objects`)
        toRemove.forEach(obj => {
          obj.removeFromParent()
        })
      }
    }
    
    // Smooth camera animation along curve - using delta time for consistent speed
    if (smoothCameraAnim?.isActive && smoothCameraAnim.curve && smoothCameraAnim.targetCurve) {
      // Clamp delta to avoid large jumps (e.g., when tab is backgrounded)
      const clampedDelta = Math.min(delta, 0.1)
      smoothAnimElapsedRef.current += clampedDelta
      
      let rawT = smoothAnimElapsedRef.current / smoothCameraAnim.duration
      
      // Handle loop or completion
      if (rawT >= 1) {
        if (smoothCameraAnim.loop) {
          smoothAnimElapsedRef.current = smoothAnimElapsedRef.current % smoothCameraAnim.duration
          rawT = smoothAnimElapsedRef.current / smoothCameraAnim.duration
        } else {
          onSmoothAnimComplete?.()
          return
        }
      }
      
      // Apply easing only for non-linear modes
      // For linear, use rawT directly for uniform speed
      let t = rawT
      switch (smoothCameraAnim.easing) {
        case 'easeIn':
          t = rawT * rawT
          break
        case 'easeOut':
          t = 1 - (1 - rawT) * (1 - rawT)
          break
        case 'easeInOut':
          t = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2
          break
        // 'linear' keeps t = rawT for uniform speed
      }
      
      // Get base position and target from curves
      const basePos = smoothCameraAnim.curve.getPointAt(t)
      let targetPos: THREE.Vector3
      
      // Get look target - blend between target curve and look-ahead on position curve
      const lookAheadAmount = smoothCameraAnim.lookAhead / 100
      if (lookAheadAmount > 0) {
        const lookT = (t + lookAheadAmount * 0.1) % 1
        const lookAheadPos = smoothCameraAnim.curve.getPointAt(lookT)
        const curveTargetPos = smoothCameraAnim.targetCurve.getPointAt(t)
        targetPos = new THREE.Vector3().lerpVectors(curveTargetPos, lookAheadPos, lookAheadAmount)
      } else {
        targetPos = smoothCameraAnim.targetCurve.getPointAt(t)
      }
      
      // Calculate base distance from target to position
      const baseDistance = basePos.distanceTo(targetPos)
      
      // Apply zoom offset to position (move camera along direction from target)
      const direction = new THREE.Vector3().subVectors(basePos, targetPos).normalize()
      const zoomedDistance = baseDistance * animZoomOffsetRef.current
      const finalPos = targetPos.clone().add(direction.multiplyScalar(zoomedDistance))
      
      // Set the target first, then position
      if (controlsRef.current) {
        controlsRef.current.target.copy(targetPos)
      }
      camera.position.copy(finalPos)
      
      // Store expected distance for next frame's zoom detection
      lastAnimDistanceRef.current = zoomedDistance
      return
    }
    
    // Animate camera to target viewpoint (stepped mode)
    if (targetCameraPos.current && targetCameraLookAt.current) {
      const lerpFactor = 0.05
      camera.position.lerp(targetCameraPos.current, lerpFactor)
      
      // Update orbit controls target for smooth look-at
      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetCameraLookAt.current, lerpFactor)
      }
      
      // Clear target when close enough
      if (camera.position.distanceTo(targetCameraPos.current) < 0.1) {
        targetCameraPos.current = null
        targetCameraLookAt.current = null
      }
    }
  })

  const config = cameraController.getConfig()
  const target = cameraController.getTargetCenter()

  return (
    <OrbitControls
      ref={controlsRef}
      target={target}
      enableDamping={config.enableDamping}
      dampingFactor={config.dampingFactor}
      minDistance={config.minDistance}
      maxDistance={config.maxDistance}
      autoRotate={autoRotate}
      autoRotateSpeed={rotateSpeed}
    />
  )
}

function createLoftGeometry(sections: THREE.Vector3[][]): THREE.BufferGeometry {
  // Guard against empty or invalid sections
  if (!sections || sections.length < 2 || !sections[0] || sections[0].length < 2) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    return geo
  }
  const vps = sections[0].length - 1 // Exclude last point (same as first for closed sections)
  const numSections = sections.length - 1 // Exclude last section (reuse first for closed loft)
  const positions: number[] = []
  const indices: number[] = []
  const uvs: number[] = []
  
  // Create vertices - skip last point of each section AND skip last section
  for (let s = 0; s < numSections; s++) {
    const v = s / numSections // Adjusted for closed loop
    for (let i = 0; i < vps; i++) {
      const pt = sections[s][i]
      positions.push(pt.x, pt.y, pt.z)
      const u = i / vps
      uvs.push(u, v)
    }
  }
  
  // Create faces - wrap both vertex and section indices for closed loft
  for (let s = 0; s < numSections; s++) {
    const sNext = (s + 1) % numSections // Wrap to section 0 for closing
    for (let i = 0; i < vps; i++) {
      const c = s * vps + i
      const next = s * vps + ((i + 1) % vps)
      const cBelow = sNext * vps + i
      const nextBelow = sNext * vps + ((i + 1) % vps)
      indices.push(c, cBelow, next)
      indices.push(next, cBelow, nextBelow)
    }
  }
  
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals() // Works correctly since both seams share vertices
  return geo
}

function SculptureScene({ onSculptureLoaded }: { onSculptureLoaded: (data: SculptureData) => void }) {
  const { scene, gl, camera } = useThree()
  const sculptureRef = useRef<THREE.Mesh | null>(null)
  const controlsRef = useRef<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadSculpture() {
      try {
        console.info('[AppLanding] Loading sculpture...')
        
        lightingController.initialize(scene, gl)

        const objData = await objLoader.load('/grasshopper-data/sculpture.obj')
        
        const pathOrCurve = objData.sculptureCurve && objData.sculptureCurve.length > 0
          ? objData.sculptureCurve
          : objData.sculpturePath

        if (!pathOrCurve || pathOrCurve.length === 0) {
          console.error('[AppLanding] No path or curve found in OBJ')
          return
        }

        const intersections = computeCrossSectionIntersections(pathOrCurve, objData.crossSections)

        const material = materialController.getMaterial()
        const sculptureData = sculptureBuilder.build(objData.crossSections, intersections, material)

        scene.add(sculptureData.mesh)
        sculptureRef.current = sculptureData.mesh

        cameraController.setCamera(camera as THREE.PerspectiveCamera)
        cameraController.centerOnBounds(sculptureData.boundingBox)

        onSculptureLoaded(sculptureData)
        setIsLoading(false)

        console.info('[AppLanding] Sculpture loaded successfully')
      } catch (error) {
        console.error('[AppLanding] Failed to load sculpture:', error)
        setIsLoading(false)
      }
    }

    loadSculpture()

    return () => {
      if (sculptureRef.current) {
        scene.remove(sculptureRef.current)
      }
      sculptureBuilder.dispose()
      lightingController.dispose()
    }
  }, [scene, gl, camera, onSculptureLoaded])

  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.update()
    }
  })

  const cameraConfig = cameraController.getConfig()
  const targetCenter = cameraController.getTargetCenter()

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        target={targetCenter}
        enableDamping={cameraConfig.enableDamping}
        dampingFactor={cameraConfig.dampingFactor}
        minDistance={cameraConfig.minDistance}
        maxDistance={cameraConfig.maxDistance}
        maxPolarAngle={cameraConfig.maxPolarAngle}
        minPolarAngle={cameraConfig.minPolarAngle}
        enablePan={cameraConfig.enablePan}
        autoRotate={cameraConfig.autoRotate}
        autoRotateSpeed={cameraConfig.autoRotateSpeed}
      />
      {isLoading && <LoadingIndicator />}
    </>
  )
}

function LoadingIndicator() {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame((_state: unknown, delta: number) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 2
    }
  })

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#4488ff" wireframe />
    </mesh>
  )
}

export function AppLanding() {
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [materialExpanded, setMaterialExpanded] = useState(false)
  const [designExpanded, setDesignExpanded] = useState(false)
  const [_philosophyExpanded, _setPhilosophyExpanded] = useState(false)
  const [uvDebugModalOpen, setUvDebugModalOpen] = useState(false)
  const [designPointsModalOpen, setDesignPointsModalOpen] = useState(false)
  const [galaxyStarsValue, setGalaxyStarsValue] = useState(0)
  const [galaxyInfoOpen, setGalaxyInfoOpen] = useState(false)
  const [galaxyInfoPos, setGalaxyInfoPos] = useState({ x: 100, y: 100 })
  const [designPathsModalOpen, setDesignPathsModalOpen] = useState(false)
  const [pathsValue, setPathsValue] = useState(0)
  const [pathsInfoOpen, setPathsInfoOpen] = useState(false)
  const [pathsInfoPos, setPathsInfoPos] = useState({ x: 100, y: 150 })
  const [designStructureModalOpen, setDesignStructureModalOpen] = useState(false)
  const [structureValue, setStructureValue] = useState(0)
  const [designCurvedModalOpen, setDesignCurvedModalOpen] = useState(false)
  const [curvedValue, setCurvedValue] = useState(0)
  const [designProfiledModalOpen, setDesignProfiledModalOpen] = useState(false)
  const [profiledValue, setProfiledValue] = useState(0)
  const [_designStoryModalOpen, setDesignStoryModalOpen] = useState(false)
  const [storyValue, setStoryValue] = useState(0)
  const [designAnimPlaying, setDesignAnimPlaying] = useState(false)
  const designAnimRef = useRef<number | null>(null)
  const [activeChapter, setActiveChapter] = useState<'points' | 'paths' | 'structure' | 'curved' | 'profiled' | 'story' | 'philosophy' | null>(null)
  const [_philosophyMode, setPhilosophyMode] = useState(false)
  
  // Per-chapter play durations in milliseconds
  const chapterDurations = {
    points: 10000,     // 10 seconds
    paths: 20000,      // 20 seconds
    structure: 15000,  // 15 seconds
    curved: 10000,     // 10 seconds
    profiled: 15000,   // 15 seconds
    story: 90000,      // 90 seconds total (1.5 minutes)
    philosophy: 90000  // 90 seconds total (1.5 minutes)
  }

  useEffect(() => {
    if (!menuOpen) {
      setMaterialExpanded(false)
      setDesignExpanded(false)
    }
  }, [menuOpen])
  const [showHull, setShowHull] = useState(false)
  const [_cameraAnimSettings, setCameraAnimSettings] = useState<CameraAnimationSettings>({
    duration: 30,
    viewpointTypes: { corner: true, edge: true, face: true },
    lookAhead: 0,
    easing: 'linear',
    mode: 'smooth',
    loop: true,
  })
  const [cameraAnimPlaying, setCameraAnimPlaying] = useState(false)
  const cameraAnimIntervalRef = useRef<number | null>(null)
  const cameraAnimStateRef = useRef<{ filteredViewpoints: CameraViewpoint[], currentIndex: number, timePerViewpoint: number } | null>(null)
  const [smoothCameraAnim, setSmoothCameraAnim] = useState<SmoothCameraAnimation | null>(null)
  const [autoRotate, setAutoRotate] = useState(false)
  const [rotateSpeed] = useState(0.5)
  const [mode, setMode] = useState<AppMode>(modeController.getMode())
  const [_sculptureLoaded, setSculptureLoaded] = useState(false)
  const [loftProgress] = useState(0)
  const [straighten] = useState(0)
  const [sphereRadius] = useState(0)
  const [starDensity] = useState(0)
  const [cosmicScale] = useState(0)
  const [bondDensity] = useState(0)
  const [starScale] = useState(0.1)
  const [galaxySize] = useState(4)
  const [cameraViewpoint, setCameraViewpoint] = useState(-1)
  const [cameraViewpoints, setCameraViewpoints] = useState<CameraViewpoint[]>([])
  const [lensLength] = useState(100) // mm equivalent
  const [webgpuSupported, setWebgpuSupported] = useState<boolean | null>(null)
  const [, setRendererInfo] = useState<{ vendor: string; renderer: string; webglVersion: string } | null>(null)
  const [debugMode] = useState(true)
  
  // AR state
  const [arSupported, setArSupported] = useState(false)
  const [arActive, setArActive] = useState(false)
  const [, setArDebug] = useState<string[]>(['Initializing AR...'])
  const arControllerRef = useRef<ARController | null>(null)
  const [sceneResetTrigger] = useState(0)
  
  // Convert lens mm to FOV: fov = 2 * atan(36 / (2 * lens_mm)) * (180/PI)
  const cameraFov = 2 * Math.atan(36 / (2 * lensLength)) * (180 / Math.PI)

  useEffect(() => {
    const unsubscribe = modeController.subscribe(setMode)
    return unsubscribe
  }, [])
  
  // Check WebGPU support on mount
  useEffect(() => {
    isWebGPUSupported().then(setWebgpuSupported)
  }, [])

  // Check AR support on mount
  useEffect(() => {
    const addDebug = (msg: string) => setArDebug(prev => [...prev.slice(-9), msg])
    
    addDebug(`navigator.xr: ${!!navigator.xr}`)
    
    const arController = new ARController({
      onSessionStart: () => { setArActive(true); addDebug('Session started') },
      onSessionEnd: () => { setArActive(false); addDebug('Session ended') },
      onSceneReset: () => { addDebug('Reloading page...'); window.location.reload() },
      onError: (err) => { addDebug(`Error: ${err.message}`) },
      onDebug: (msg) => { addDebug(msg) }
    })
    arControllerRef.current = arController
    
    if (!navigator.xr) {
      addDebug('WebXR not available')
      return
    }
    
    arController.isARSupported().then((supported) => {
      addDebug(`AR supported: ${supported}`)
      setArSupported(supported)
    }).catch(err => {
      addDebug(`AR check failed: ${err}`)
    })
  }, [])

  const handleEnterAR = async () => {
    setArDebug(prev => [...prev.slice(-9), 'Attempting to start AR...'])
    if (!arControllerRef.current) {
      setArDebug(prev => [...prev.slice(-9), 'No AR controller'])
      return
    }
    try {
      const success = await arControllerRef.current.startARSession()
      setArDebug(prev => [...prev.slice(-9), `startARSession result: ${success}`])
    } catch (err) {
      setArDebug(prev => [...prev.slice(-9), `AR start error: ${err}`])
    }
  }

  const handleSculptureLoaded = useCallback(() => {
    setSculptureLoaded(true)
  }, [])

  const handleAutoRotateToggle = () => {
    const newValue = !autoRotate
    setAutoRotate(newValue)
    cameraController.setAutoRotate(newValue)
  }

  // Handle play button for design animations
  const handleDesignPlayToggle = () => {
    // If already playing, stop
    if (designAnimPlaying) {
      if (designAnimRef.current) {
        cancelAnimationFrame(designAnimRef.current)
        designAnimRef.current = null
      }
      setDesignAnimPlaying(false)
      return
    }

    // Determine which slider to animate based on active chapter
    let currentValue = 0
    let setValue: (v: number) => void

    if (activeChapter === 'story') {
      currentValue = storyValue
      setValue = (v: number) => {
        setStoryValue(v)
        // Trigger the same logic as the Story slider onChange
        if (v <= 20) {
          const phaseProgress = (v / 20) * 100
          setGalaxyStarsValue(phaseProgress)
          setPathsValue(0)
          setStructureValue(0)
          setCurvedValue(0)
          setDesignPathsModalOpen(false)
          setDesignStructureModalOpen(false)
          setDesignCurvedModalOpen(false)
        } else if (v <= 40) {
          const phaseProgress = ((v - 20) / 20) * 100
          setGalaxyStarsValue(100)
          setPathsValue(phaseProgress)
          setStructureValue(0)
          setCurvedValue(0)
          setDesignPathsModalOpen(true)
          setDesignStructureModalOpen(false)
          setDesignCurvedModalOpen(false)
        } else if (v <= 60) {
          const phaseProgress = ((v - 40) / 20) * 100
          setGalaxyStarsValue(100)
          setPathsValue(100)
          setStructureValue(phaseProgress)
          setCurvedValue(0)
          setDesignPathsModalOpen(true)
          setDesignStructureModalOpen(true)
          setDesignCurvedModalOpen(false)
        } else if (v <= 80) {
          const phaseProgress = ((v - 60) / 20) * 100
          setGalaxyStarsValue(100)
          setPathsValue(100)
          setStructureValue(100)
          setCurvedValue(phaseProgress)
          setProfiledValue(0)
          setDesignPathsModalOpen(true)
          setDesignStructureModalOpen(true)
          setDesignCurvedModalOpen(true)
          setDesignProfiledModalOpen(false)
        } else {
          // Profiled phase (80-100%)
          const phaseProgress = ((v - 80) / 20) * 100
          setGalaxyStarsValue(100)
          setPathsValue(100)
          setStructureValue(100)
          setCurvedValue(100)
          setProfiledValue(phaseProgress)
          setDesignPathsModalOpen(true)
          setDesignStructureModalOpen(true)
          setDesignCurvedModalOpen(true)
          setDesignProfiledModalOpen(true)
        }
      }
    } else if (activeChapter === 'profiled') {
      currentValue = profiledValue
      setValue = setProfiledValue
    } else if (activeChapter === 'curved') {
      currentValue = curvedValue
      setValue = setCurvedValue
    } else if (activeChapter === 'structure') {
      currentValue = structureValue
      setValue = setStructureValue
    } else if (activeChapter === 'paths') {
      currentValue = pathsValue
      setValue = setPathsValue
    } else if (activeChapter === 'points') {
      currentValue = galaxyStarsValue
      setValue = setGalaxyStarsValue
    } else if (activeChapter === 'philosophy') {
      currentValue = storyValue
      setValue = (v: number) => {
        setStoryValue(v)
        // Same phase mapping as story
        if (v <= 20) {
          const phaseProgress = (v / 20) * 100
          setGalaxyStarsValue(phaseProgress)
          setPathsValue(0)
          setStructureValue(0)
          setCurvedValue(0)
          setProfiledValue(0)
          setDesignPathsModalOpen(false)
          setDesignStructureModalOpen(false)
          setDesignCurvedModalOpen(false)
          setDesignProfiledModalOpen(false)
        } else if (v <= 40) {
          const phaseProgress = ((v - 20) / 20) * 100
          setGalaxyStarsValue(100)
          setPathsValue(phaseProgress)
          setStructureValue(0)
          setCurvedValue(0)
          setProfiledValue(0)
          setDesignPathsModalOpen(true)
          setDesignStructureModalOpen(false)
          setDesignCurvedModalOpen(false)
          setDesignProfiledModalOpen(false)
        } else if (v <= 60) {
          const phaseProgress = ((v - 40) / 20) * 100
          setGalaxyStarsValue(100)
          setPathsValue(100)
          setStructureValue(phaseProgress)
          setCurvedValue(0)
          setProfiledValue(0)
          setDesignPathsModalOpen(true)
          setDesignStructureModalOpen(true)
          setDesignCurvedModalOpen(false)
          setDesignProfiledModalOpen(false)
        } else if (v <= 80) {
          const phaseProgress = ((v - 60) / 20) * 100
          setGalaxyStarsValue(100)
          setPathsValue(100)
          setStructureValue(100)
          setCurvedValue(phaseProgress)
          setProfiledValue(0)
          setDesignPathsModalOpen(true)
          setDesignStructureModalOpen(true)
          setDesignCurvedModalOpen(true)
          setDesignProfiledModalOpen(false)
        } else {
          const phaseProgress = ((v - 80) / 20) * 100
          setGalaxyStarsValue(100)
          setPathsValue(100)
          setStructureValue(100)
          setCurvedValue(100)
          setProfiledValue(phaseProgress)
          setDesignPathsModalOpen(true)
          setDesignStructureModalOpen(true)
          setDesignCurvedModalOpen(true)
          setDesignProfiledModalOpen(true)
        }
      }
    } else {
      return // No chapter selected
    }

    // Start animation
    setDesignAnimPlaying(true)
    const startTime = performance.now()
    const duration = activeChapter ? chapterDurations[activeChapter] : 10000
    const startValue = currentValue

    const animate = (time: number) => {
      const elapsed = time - startTime
      const progress = Math.min(elapsed / duration, 1)
      const newValue = startValue + (100 - startValue) * progress

      setValue(newValue)

      if (progress < 1) {
        designAnimRef.current = requestAnimationFrame(animate)
      } else {
        setDesignAnimPlaying(false)
        designAnimRef.current = null
      }
    }

    designAnimRef.current = requestAnimationFrame(animate)
  }

  const handlePlayCameraAnimation = (settings: CameraAnimationSettings) => {
    // If already playing, pause/stop
    if (cameraAnimPlaying) {
      if (settings.mode === 'smooth') {
        setSmoothCameraAnim(null)
      } else {
        if (cameraAnimIntervalRef.current) clearInterval(cameraAnimIntervalRef.current)
        cameraAnimIntervalRef.current = null
      }
      setCameraAnimPlaying(false)
      console.info('[CameraAnimation] Paused')
      return
    }

    // Filter viewpoints by selected types
    const filteredViewpoints = cameraViewpoints.filter(vp => {
      if (vp.type === 'corner' && settings.viewpointTypes.corner) return true
      if (vp.type === 'edge' && settings.viewpointTypes.edge) return true
      if (vp.type === 'face' && settings.viewpointTypes.face) return true
      return false
    })

    if (filteredViewpoints.length < 2) {
      console.warn('[CameraAnimation] Need at least 2 viewpoints')
      return
    }

    console.info(`[CameraAnimation] Playing ${filteredViewpoints.length} viewpoints over ${settings.duration}s (${settings.mode} mode)`)
    setCameraAnimPlaying(true)

    if (settings.mode === 'smooth') {
      // Create smooth curves through viewpoint positions and targets
      const positions = filteredViewpoints.map(vp => vp.position.clone())
      const targets = filteredViewpoints.map(vp => vp.target.clone())
      
      const positionCurve = new THREE.CatmullRomCurve3(positions, true, 'centripetal', 0.5)
      const targetCurve = new THREE.CatmullRomCurve3(targets, true, 'centripetal', 0.5)
      
      // Reset elapsed time ref in DebugLoftScene will be handled by the animation starting fresh
      setSmoothCameraAnim({
        isActive: true,
        curve: positionCurve,
        targetCurve: targetCurve,
        duration: settings.duration,
        lookAhead: settings.lookAhead,
        loop: settings.loop,
        easing: settings.easing,
      })
    } else {
      // Stepped mode - jump between viewpoints
      const getFullIndex = (filtered: CameraViewpoint) => {
        return cameraViewpoints.findIndex(vp => vp === filtered)
      }
      
      const timePerViewpoint = (settings.duration * 1000) / filteredViewpoints.length
      cameraAnimStateRef.current = { filteredViewpoints, currentIndex: 0, timePerViewpoint }
      setCameraViewpoint(getFullIndex(filteredViewpoints[0]))

      const runAnimation = () => {
        cameraAnimStateRef.current!.currentIndex++
        if (cameraAnimStateRef.current!.currentIndex >= filteredViewpoints.length) {
          if (settings.loop) {
            cameraAnimStateRef.current!.currentIndex = 0
          } else {
            if (cameraAnimIntervalRef.current) clearInterval(cameraAnimIntervalRef.current)
            cameraAnimIntervalRef.current = null
            cameraAnimStateRef.current = null
            setCameraAnimPlaying(false)
            console.info('[CameraAnimation] Animation complete')
            return
          }
        }
        setCameraViewpoint(getFullIndex(filteredViewpoints[cameraAnimStateRef.current!.currentIndex]))
      }

      cameraAnimIntervalRef.current = window.setInterval(runAnimation, timePerViewpoint)
    }
  }

  const handleSmoothAnimComplete = () => {
    setSmoothCameraAnim(null)
    setCameraAnimPlaying(false)
    console.info('[CameraAnimation] Smooth animation complete')
  }

  if (mode === 'STORY_MODE') {
    return (
      <div style={styles.storyModePlaceholder}>
        <h1>Story Mode</h1>
        <p>Chapters coming soon...</p>
        <button onClick={() => modeController.setMode('LANDING_MODE')} style={styles.button}>
          Back to Landing
        </button>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <Canvas
        camera={{ position: [40, 30, 40], fov: cameraFov, near: 0.5, far: 1000 }}
        gl={{ 
          antialias: true, 
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          powerPreference: 'high-performance',
          alpha: true,
        }}
        style={{ background: arActive ? 'transparent' : '#0a0a0a' }}
        onCreated={({ gl }: { gl: THREE.WebGLRenderer }) => {
          const info = getRendererInfo(gl)
          setRendererInfo(info)
          console.info(`[Renderer] ${info.webglVersion} - ${info.renderer}`)
        }}
      >
        {debugMode ? (
          <DebugLoftScene loftProgress={loftProgress} straighten={straighten} onLoaded={handleSculptureLoaded} autoRotate={autoRotate} rotateSpeed={rotateSpeed} sphereRadius={sphereRadius} starDensity={starDensity} cosmicScale={cosmicScale} bondDensity={bondDensity} starScale={starScale} galaxySize={galaxySize} cameraViewpoint={cameraViewpoint} cameraFov={cameraFov} useGpu={webgpuSupported === true} onCameraViewpointsComputed={setCameraViewpoints} smoothCameraAnim={smoothCameraAnim} onSmoothAnimComplete={handleSmoothAnimComplete} showHull={showHull} arController={arControllerRef.current} sceneResetTrigger={sceneResetTrigger} galaxyStars={galaxyStarsValue} showPoints={designPointsModalOpen} pathsValue={pathsValue} showPaths={designPathsModalOpen} structureValue={structureValue} showStructure={designStructureModalOpen} curvedValue={curvedValue} showCurved={designCurvedModalOpen} profiledValue={profiledValue} showProfiled={designProfiledModalOpen} />
        ) : (
          <SculptureScene onSculptureLoaded={handleSculptureLoaded} />
        )}
      </Canvas>

      
      {/* 3-dot menu top right */}
      <div style={styles.menuContainer}>
        <button
          style={styles.menuButton}
          onClick={() => setMenuOpen(!menuOpen)}
          title="Menu"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <circle cx="10" cy="4" r="2" />
            <circle cx="10" cy="10" r="2" />
            <circle cx="10" cy="16" r="2" />
          </svg>
        </button>
        {menuOpen && (
          <div style={styles.dropdown}>
            <div style={{ position: 'relative' }}>
              <button
                style={styles.dropdownItem}
                onClick={() => setMaterialExpanded(!materialExpanded)}
              >
                Material {materialExpanded ? '▾' : '▸'}
              </button>
              {materialExpanded && (
                <div style={{ paddingLeft: '12px', background: 'rgba(0,0,0,0.3)' }}>
                  <button style={styles.dropdownItem} onClick={() => { materialController.loadPBRFromZip('/PBR/Metal048A_2K-JPG.zip'); setMenuOpen(false); }}>Gold</button>
                  <button style={styles.dropdownItem} onClick={() => { materialController.applyPreset('stainlessSteel'); setMenuOpen(false); }}>Stainless Steel</button>
                  <button style={styles.dropdownItem} onClick={() => { materialController.loadPBRFromZip('/PBR/Bronze.zip'); setMenuOpen(false); }}>Bronze</button>
                  <button style={styles.dropdownItem} onClick={() => { materialController.loadPBRFromZip('/PBR/A23D_Old-Rusted-Raw-Metal_4K.zip'); setMenuOpen(false); }}>Corten</button>
                  <button style={styles.dropdownItem} onClick={() => { setMenuOpen(false); }}>Marble</button>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <button
                style={styles.dropdownItem}
                onClick={() => setDesignExpanded(!designExpanded)}
              >
                Design {designExpanded ? '▾' : '▸'}
              </button>
              {designExpanded && (
                <div style={{ paddingLeft: '12px', background: 'rgba(0,0,0,0.3)' }}>
                  <button style={styles.dropdownItem} onClick={() => { 
                    // Clean up other chapters
                    setPathsValue(0); 
                    setStructureValue(0); 
                    setCurvedValue(0); 
                    setProfiledValue(0);
                    setDesignPathsModalOpen(false);
                    setDesignStructureModalOpen(false);
                    setDesignCurvedModalOpen(false);
                    setDesignProfiledModalOpen(false);
                    // Reset Points chapter to start
                    setGalaxyStarsValue(0);
                    setDesignPointsModalOpen(true); 
                    setActiveChapter('points'); 
                    setMenuOpen(false); 
                  }}>Points</button>
                  <button style={styles.dropdownItem} onClick={() => { setDesignPathsModalOpen(true); setDesignPointsModalOpen(true); setGalaxyStarsValue(100); setActiveChapter('paths'); setMenuOpen(false); }}>Paths</button>
                  <button style={styles.dropdownItem} onClick={() => { setDesignStructureModalOpen(true); setDesignPathsModalOpen(true); setDesignPointsModalOpen(true); setGalaxyStarsValue(100); setPathsValue(100); setActiveChapter('structure'); setMenuOpen(false); }}>Structure</button>
                  <button style={styles.dropdownItem} onClick={() => { setDesignCurvedModalOpen(true); setDesignStructureModalOpen(true); setDesignPathsModalOpen(true); setDesignPointsModalOpen(true); setGalaxyStarsValue(100); setPathsValue(100); setStructureValue(100); setActiveChapter('curved'); setMenuOpen(false); }}>Curved</button>
                  <button style={styles.dropdownItem} onClick={() => { setDesignProfiledModalOpen(true); setDesignCurvedModalOpen(true); setDesignStructureModalOpen(true); setDesignPathsModalOpen(true); setDesignPointsModalOpen(true); setGalaxyStarsValue(100); setPathsValue(100); setStructureValue(100); setCurvedValue(100); setActiveChapter('profiled'); setMenuOpen(false); }}>Profiled</button>
                  <button style={styles.dropdownItem} onClick={() => { setDesignStoryModalOpen(true); setDesignPointsModalOpen(true); setStoryValue(0); setActiveChapter('story'); setMenuOpen(false); }}>Story</button>
                </div>
              )}
            </div>
            <button
              style={styles.dropdownItem}
              onClick={() => { 
                setPhilosophyMode(true)
                setDesignStoryModalOpen(true)
                setDesignPointsModalOpen(true)
                setStoryValue(0)
                setActiveChapter('philosophy')
                setMenuOpen(false)
              }}
            >
              Philosophy
            </button>
            {arSupported && !arActive && (
              <button
                style={styles.dropdownItem}
                onClick={() => { handleEnterAR(); setMenuOpen(false); }}
              >
                View in AR
              </button>
            )}
            <button
              style={{ ...styles.dropdownItem, color: '#888' }}
              onClick={() => { setSettingsModalOpen(true); setMenuOpen(false); }}
            >
              Settings
            </button>
                      </div>
        )}
      </div>

      {/* Context-sensitive title and subtitle with dynamic narration */}
      {activeChapter && (() => {
        // Dynamic narration based on chapter and slider position
        let title = ''
        let subtitle = ''
        
        if (activeChapter === 'points' || (activeChapter === 'story' && storyValue <= 20)) {
          const val = activeChapter === 'story' ? (storyValue / 20) * 100 : galaxyStarsValue
          if (val <= 20) {
            title = 'How This Sculpture Was Created'
            subtitle = 'From its final form, we begin again.'
          } else {
            title = 'Points in Space'
            subtitle = 'My sculptures are based on points in space.'
          }
        } else if (activeChapter === 'paths' || (activeChapter === 'story' && storyValue <= 40)) {
          const val = activeChapter === 'story' ? ((storyValue - 20) / 20) * 100 : pathsValue
          if (val <= 20) {
            // Phase 1-2: Galaxy stars and shooting stars (0-20%)
            title = 'Lines in the Cosmos'
            subtitle = 'Stars connect, forming fleeting shapes'
          } else if (val <= 35) {
            // Phase 3: Shapes form (20-35%)
            title = 'From Stars to Symbols'
            subtitle = 'Civilizations imagined meaning in these shapes'
          } else if (val <= 50) {
            // Phase 4: Faint connecting lines (35-50%)
            title = 'Infinite Possible Paths'
            subtitle = 'Every point connects to countless others'
          } else if (val <= 70) {
            // Phase 5-6: Contract and zoom into star (50-70%)
            title = 'Diving Into the Light'
            subtitle = "Let's explore the structure within a single star"
          } else if (val <= 85) {
            // Phase 7: White space, tiny black speck (70-85%)
            title = 'Inside the Star'
            subtitle = 'A tiny speck emerges from the light'
          } else {
            // Phase 8: Lattice reveal (85-100%)
            title = 'The Atomic Structure'
            subtitle = 'Within all matter, a hidden lattice awaits.'
          }
        } else if (activeChapter === 'structure' || (activeChapter === 'story' && storyValue <= 60)) {
          const val = activeChapter === 'story' ? ((storyValue - 40) / 20) * 100 : structureValue
          if (val <= 25) {
            title = 'Crystallization'
            subtitle = 'Order begins to emerge from chaos'
          } else if (val <= 50) {
            title = 'The Lattice'
            subtitle = 'A geometric framework takes hold'
          } else if (val <= 75) {
            title = 'Dissolution'
            subtitle = 'Rigid structure yields to something new'
          } else {
            title = 'Transformation'
            subtitle = 'The skeleton of form remains'
          }
        } else if (activeChapter === 'curved' || (activeChapter === 'story' && storyValue <= 80)) {
          const val = activeChapter === 'story' ? ((storyValue - 60) / 20) * 100 : curvedValue
          if (val <= 25) {
            title = 'Softening'
            subtitle = 'Sharp angles begin to relax'
          } else if (val <= 50) {
            title = 'Flow'
            subtitle = 'Lines learn to bend and breathe'
          } else if (val <= 75) {
            title = 'Grace'
            subtitle = 'The path finds its natural rhythm'
          } else {
            title = 'Organic'
            subtitle = 'Geometry surrenders to nature'
          }
        } else if (activeChapter === 'profiled' || (activeChapter === 'story' && storyValue > 80)) {
          const val = activeChapter === 'story' ? ((storyValue - 80) / 20) * 100 : profiledValue
          if (val <= 15) {
            title = 'Becoming'
            subtitle = 'The essence begins to take form'
          } else if (val <= 35) {
            title = 'Growth'
            subtitle = 'Material sweeps along the path'
          } else if (val <= 55) {
            title = 'Expansion'
            subtitle = 'The sculpture fills its space'
          } else if (val <= 75) {
            title = 'Refinement'
            subtitle = 'Details emerge in the final form'
          } else if (val <= 95) {
            title = 'Completion'
            subtitle = 'The vision becomes reality'
          } else {
            title = 'Eternal'
            subtitle = 'A moment frozen in time, forever'
          }
        } else if (activeChapter === 'philosophy') {
          // Philosophy narration - same animation, different meaning
          if (storyValue <= 20) {
            // Chapter 1: PERSPECTIVE
            const val = (storyValue / 20) * 100
            if (val <= 10) {
              title = 'In The Beginning'
              subtitle = 'When we know nothing, we see only shadows'
            } else if (val <= 25) {
              title = 'A Spark'
              subtitle = 'One insight illuminates an entire new reality'
            } else if (val <= 50) {
              title = 'Awakening'
              subtitle = 'As perspective expands, so does our understanding'
            } else if (val <= 75) {
              title = 'Multiplicity'
              subtitle = 'The world is revealed as full of endless viewpoints'
            } else {
              title = 'The Cosmos'
              subtitle = 'Infinite perspectives create the universe of truth'
            }
          } else if (storyValue <= 40) {
            // Chapter 2: CONNECTION
            const val = ((storyValue - 20) / 20) * 100
            if (val <= 20) {
              title = 'First Movement'
              subtitle = 'To understand is to begin to reach out'
            } else if (val <= 40) {
              title = 'Seeking'
              subtitle = 'We search for meaning by connecting one idea to another'
            } else if (val <= 60) {
              title = 'Convergence'
              subtitle = 'Perspectives meet, forming deeper insights'
            } else if (val <= 80) {
              title = 'The Path Emerges'
              subtitle = 'Our understanding is a journey built on connections'
            } else {
              title = 'Connected'
              subtitle = 'All insights form a continuous exploration'
            }
          } else if (storyValue <= 60) {
            // Chapter 3: FORM
            const val = ((storyValue - 40) / 20) * 100
            if (val <= 25) {
              title = 'Crystallization'
              subtitle = 'Understanding takes shape from scattered thoughts'
            } else if (val <= 50) {
              title = 'The Lattice'
              subtitle = 'The structure of knowledge gives order to perspective'
            } else if (val <= 75) {
              title = 'Dissolution'
              subtitle = 'Growth demands that we release rigid assumptions'
            } else {
              title = 'Transformation'
              subtitle = 'The framework remains, but meaning evolves'
            }
          } else if (storyValue <= 80) {
            // Chapter 4: FLUIDITY
            const val = ((storyValue - 60) / 20) * 100
            if (val <= 25) {
              title = 'Softening'
              subtitle = 'True understanding bends with openness'
            } else if (val <= 50) {
              title = 'Flow'
              subtitle = 'Perspective thrives when it adapts and moves'
            } else if (val <= 75) {
              title = 'Grace'
              subtitle = 'We discover beauty in the harmony of flexibility'
            } else {
              title = 'Organic'
              subtitle = 'Insight aligns with nature, ever-evolving'
            }
          } else {
            // Chapter 5: REALIZATION
            const val = ((storyValue - 80) / 20) * 100
            if (val <= 15) {
              title = 'Becoming'
              subtitle = 'We start to embody the wisdom we\'ve built'
            } else if (val <= 35) {
              title = 'Growth'
              subtitle = 'We manifest our newfound perspective in life'
            } else if (val <= 55) {
              title = 'Expansion'
              subtitle = 'Our awareness fills the world around us'
            } else if (val <= 75) {
              title = 'Refinement'
              subtitle = 'We sharpen our perspective, seeing what was hidden'
            } else if (val <= 95) {
              title = 'Completion'
              subtitle = 'True understanding lingers beyond time'
            } else {
              title = 'Eternal'
              subtitle = 'Perspective is a lifelong gift—forever changing how we see'
            }
          }
        }
        
        return (
          <div style={{
            position: 'absolute',
            top: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            zIndex: 10,
            pointerEvents: 'none',
            background: 'rgba(0, 0, 0, 0.4)',
            padding: '16px 32px',
            borderRadius: '8px',
            backdropFilter: 'blur(4px)'
          }}>
            <h1 style={{
              margin: 0,
              fontSize: '28px',
              fontWeight: 300,
              letterSpacing: '4px',
              textTransform: 'uppercase',
              color: 'rgba(255, 255, 255, 0.95)',
              textShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif"
            }}>
              {title}
            </h1>
            <p style={{
              margin: '8px 0 0 0',
              fontSize: '14px',
              fontWeight: 300,
              letterSpacing: '1px',
              color: 'rgba(255, 255, 255, 0.85)',
              textShadow: '0 1px 6px rgba(0, 0, 0, 0.4)',
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              fontStyle: 'italic'
            }}>
              {subtitle}
            </p>
          </div>
        )
      })()}

      {/* Galaxy Stars slider - shows when Points chapter is active */}
      {activeChapter === 'points' && (
        <div style={styles.galaxySliderContainer}>
          <input
            type="range"
            min="0"
            max="100"
            value={galaxyStarsValue}
            onChange={(e) => setGalaxyStarsValue(Number(e.target.value))}
            style={styles.galaxySlider}
          />
          <button
            style={styles.infoButton}
            onClick={() => setGalaxyInfoOpen(true)}
            title="Info"
          >
            i
          </button>
        </div>
      )}

      {/* Paths slider - shows when Paths chapter is active */}
      {activeChapter === 'paths' && (
        <div style={styles.galaxySliderContainer}>
          <input
            type="range"
            min="0"
            max="100"
            value={pathsValue}
            onChange={(e) => setPathsValue(Number(e.target.value))}
            style={styles.galaxySlider}
          />
          <button
            style={styles.infoButton}
            onClick={() => setPathsInfoOpen(true)}
            title="Info"
          >
            i
          </button>
        </div>
      )}

      {/* Structure slider - shows when Structure chapter is active */}
      {activeChapter === 'structure' && (
        <div style={styles.galaxySliderContainer}>
          <input
            type="range"
            min="0"
            max="100"
            value={structureValue}
            onChange={(e) => setStructureValue(Number(e.target.value))}
            style={styles.galaxySlider}
          />
          <button
            style={styles.infoButton}
            onClick={() => {}}
            title="Info"
          >
            i
          </button>
        </div>
      )}

      {/* Curved slider - shows when Curved chapter is active */}
      {activeChapter === 'curved' && (
        <div style={styles.galaxySliderContainer}>
          <input
            type="range"
            min="0"
            max="100"
            value={curvedValue}
            onChange={(e) => setCurvedValue(Number(e.target.value))}
            style={styles.galaxySlider}
          />
          <button
            style={styles.infoButton}
            onClick={() => {}}
            title="Info"
          >
            i
          </button>
        </div>
      )}

      {/* Profiled slider - shows when Profiled chapter is active */}
      {activeChapter === 'profiled' && (
        <div style={styles.galaxySliderContainer}>
          <input
            type="range"
            min="0"
            max="100"
            value={profiledValue}
            onChange={(e) => setProfiledValue(Number(e.target.value))}
            style={styles.galaxySlider}
          />
          <button
            style={styles.infoButton}
            onClick={() => {}}
            title="Info"
          >
            i
          </button>
        </div>
      )}

      {/* Story slider - shows when Story chapter is active */}
      {activeChapter === 'story' && (
        <div style={styles.galaxySliderContainer}>
          <input
            type="range"
            min="0"
            max="100"
            value={storyValue}
            onChange={(e) => {
              const val = Number(e.target.value)
              setStoryValue(val)
              
              // Map story value to sequential phases (5 phases, 20% each):
              // 0-20: Points (galaxyStarsValue 0-100)
              // 20-40: Paths (pathsValue 0-100)
              // 40-60: Structure (structureValue 0-100)
              // 60-80: Curved (curvedValue 0-100)
              // 80-100: Profiled (profiledValue 0-100)
              
              if (val <= 20) {
                // Points phase
                const phaseProgress = (val / 20) * 100
                setGalaxyStarsValue(phaseProgress)
                setPathsValue(0)
                setStructureValue(0)
                setCurvedValue(0)
                setProfiledValue(0)
                setDesignPathsModalOpen(false)
                setDesignStructureModalOpen(false)
                setDesignCurvedModalOpen(false)
                setDesignProfiledModalOpen(false)
              } else if (val <= 40) {
                // Paths phase
                const phaseProgress = ((val - 20) / 20) * 100
                setGalaxyStarsValue(100)
                setPathsValue(phaseProgress)
                setStructureValue(0)
                setCurvedValue(0)
                setProfiledValue(0)
                setDesignPathsModalOpen(true)
                setDesignStructureModalOpen(false)
                setDesignCurvedModalOpen(false)
                setDesignProfiledModalOpen(false)
              } else if (val <= 60) {
                // Structure phase
                const phaseProgress = ((val - 40) / 20) * 100
                setGalaxyStarsValue(100)
                setPathsValue(100)
                setStructureValue(phaseProgress)
                setCurvedValue(0)
                setProfiledValue(0)
                setDesignPathsModalOpen(true)
                setDesignStructureModalOpen(true)
                setDesignCurvedModalOpen(false)
                setDesignProfiledModalOpen(false)
              } else if (val <= 80) {
                // Curved phase
                const phaseProgress = ((val - 60) / 20) * 100
                setGalaxyStarsValue(100)
                setPathsValue(100)
                setStructureValue(100)
                setCurvedValue(phaseProgress)
                setProfiledValue(0)
                setDesignPathsModalOpen(true)
                setDesignStructureModalOpen(true)
                setDesignCurvedModalOpen(true)
                setDesignProfiledModalOpen(false)
              } else {
                // Profiled phase
                const phaseProgress = ((val - 80) / 20) * 100
                setGalaxyStarsValue(100)
                setPathsValue(100)
                setStructureValue(100)
                setCurvedValue(100)
                setProfiledValue(phaseProgress)
                setDesignPathsModalOpen(true)
                setDesignStructureModalOpen(true)
                setDesignCurvedModalOpen(true)
                setDesignProfiledModalOpen(true)
              }
            }}
            style={styles.galaxySlider}
          />
          <button
            style={styles.infoButton}
            onClick={() => {}}
            title="Info"
          >
            i
          </button>
        </div>
      )}

      {/* Philosophy slider - shows when Philosophy is active */}
      {activeChapter === 'philosophy' && (
        <div style={styles.galaxySliderContainer}>
          <input
            type="range"
            min="0"
            max="100"
            value={storyValue}
            onChange={(e) => {
              const val = Number(e.target.value)
              setStoryValue(val)
              
              // Same phase mapping as story - just different narration text
              if (val <= 20) {
                const phaseProgress = (val / 20) * 100
                setGalaxyStarsValue(phaseProgress)
                setPathsValue(0)
                setStructureValue(0)
                setCurvedValue(0)
                setProfiledValue(0)
                setDesignPathsModalOpen(false)
                setDesignStructureModalOpen(false)
                setDesignCurvedModalOpen(false)
                setDesignProfiledModalOpen(false)
              } else if (val <= 40) {
                const phaseProgress = ((val - 20) / 20) * 100
                setGalaxyStarsValue(100)
                setPathsValue(phaseProgress)
                setStructureValue(0)
                setCurvedValue(0)
                setProfiledValue(0)
                setDesignPathsModalOpen(true)
                setDesignStructureModalOpen(false)
                setDesignCurvedModalOpen(false)
                setDesignProfiledModalOpen(false)
              } else if (val <= 60) {
                const phaseProgress = ((val - 40) / 20) * 100
                setGalaxyStarsValue(100)
                setPathsValue(100)
                setStructureValue(phaseProgress)
                setCurvedValue(0)
                setProfiledValue(0)
                setDesignPathsModalOpen(true)
                setDesignStructureModalOpen(true)
                setDesignCurvedModalOpen(false)
                setDesignProfiledModalOpen(false)
              } else if (val <= 80) {
                const phaseProgress = ((val - 60) / 20) * 100
                setGalaxyStarsValue(100)
                setPathsValue(100)
                setStructureValue(100)
                setCurvedValue(phaseProgress)
                setProfiledValue(0)
                setDesignPathsModalOpen(true)
                setDesignStructureModalOpen(true)
                setDesignCurvedModalOpen(true)
                setDesignProfiledModalOpen(false)
              } else {
                const phaseProgress = ((val - 80) / 20) * 100
                setGalaxyStarsValue(100)
                setPathsValue(100)
                setStructureValue(100)
                setCurvedValue(100)
                setProfiledValue(phaseProgress)
                setDesignPathsModalOpen(true)
                setDesignStructureModalOpen(true)
                setDesignCurvedModalOpen(true)
                setDesignProfiledModalOpen(true)
              }
            }}
            style={styles.galaxySlider}
          />
          <button
            style={styles.infoButton}
            onClick={() => {}}
            title="Info"
          >
            i
          </button>
        </div>
      )}

      {/* Play button bottom right - plays design animation when chapter is selected, otherwise auto-rotate */}
      <button
        style={{ ...styles.autoRotateButton, background: (designAnimPlaying || autoRotate) ? '#4488ff' : 'rgba(0,0,0,0.7)' }}
        onClick={activeChapter ? handleDesignPlayToggle : handleAutoRotateToggle}
        title={activeChapter ? (designAnimPlaying ? "Pause" : "Play") : "Auto Rotate"}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          {designAnimPlaying ? (
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          ) : (
            <path d="M8 5v14l11-7z" />
          )}
        </svg>
      </button>

      {/* Exit AR button when in AR */}
      {arActive && (
        <button
          style={styles.arButtonActive}
          onClick={() => arControllerRef.current?.endARSession()}
          title="Exit AR"
        >
          Exit AR
        </button>
      )}

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        onCameraSettingsChange={setCameraAnimSettings}
        onCameraPlay={handlePlayCameraAnimation}
        isCameraPlaying={cameraAnimPlaying}
        showHull={showHull}
        onShowHullChange={setShowHull}
      />
      <UVDebugModal
        isOpen={uvDebugModalOpen}
        onClose={() => setUvDebugModalOpen(false)}
      />
      {/* Draggable Paths Info Modal */}
      {pathsInfoOpen && (
        <div
          style={{
            position: 'fixed',
            left: pathsInfoPos.x,
            top: pathsInfoPos.y,
            background: 'rgba(20,20,20,0.95)',
            borderRadius: '8px',
            padding: '12px 16px',
            zIndex: 1000,
            cursor: 'move',
            maxWidth: '280px',
            backdropFilter: 'blur(10px)',
          }}
          onMouseDown={(e) => {
            const startX = e.clientX - pathsInfoPos.x
            const startY = e.clientY - pathsInfoPos.y
            const onMove = (ev: MouseEvent) => {
              setPathsInfoPos({ x: ev.clientX - startX, y: ev.clientY - startY })
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ color: '#fff', fontSize: '13px', fontFamily: 'sans-serif' }}>Paths</span>
            <button
              onClick={() => setPathsInfoOpen(false)}
              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px', padding: 0 }}
            >×</button>
          </div>
          <p style={{ color: '#999', fontSize: '12px', fontFamily: 'sans-serif', margin: 0, lineHeight: 1.4 }}>
            <strong>0-30%:</strong> Random short paths between stars<br/>
            <strong>30-60%:</strong> Constellations like Big Dipper<br/>
            <strong>60-90%:</strong> Paths converging toward sculpture<br/>
            <strong>90-100%:</strong> Final sculpture heartline path
          </p>
        </div>
      )}

      {/* Draggable Galaxy Stars Info Modal */}
      {galaxyInfoOpen && (
        <div
          style={{
            position: 'fixed',
            left: galaxyInfoPos.x,
            top: galaxyInfoPos.y,
            background: 'rgba(20,20,20,0.95)',
            borderRadius: '8px',
            padding: '12px 16px',
            zIndex: 1000,
            cursor: 'move',
            maxWidth: '250px',
            backdropFilter: 'blur(10px)',
          }}
          onMouseDown={(e) => {
            const startX = e.clientX - galaxyInfoPos.x
            const startY = e.clientY - galaxyInfoPos.y
            const onMove = (ev: MouseEvent) => {
              setGalaxyInfoPos({ x: ev.clientX - startX, y: ev.clientY - startY })
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ color: '#fff', fontSize: '13px', fontFamily: 'sans-serif' }}>Galaxy Stars</span>
            <button
              onClick={() => setGalaxyInfoOpen(false)}
              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px', padding: 0 }}
            >×</button>
          </div>
          <p style={{ color: '#999', fontSize: '12px', fontFamily: 'sans-serif', margin: 0, lineHeight: 1.4 }}>
            Adds a field of stars around the sculpture in a galaxy-like disc pattern, creating a cosmic atmosphere.
          </p>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  menuContainer: {
    position: 'absolute',
    top: '20px',
    right: '20px',
  },
  menuButton: {
    width: '44px',
    height: '44px',
    borderRadius: '8px',
    border: 'none',
    background: 'rgba(0,0,0,0.7)',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(10px)',
  },
  dropdown: {
    position: 'absolute',
    top: '50px',
    right: '0',
    background: 'rgba(0,0,0,0.9)',
    borderRadius: '8px',
    padding: '8px 0',
    minWidth: '140px',
    backdropFilter: 'blur(10px)',
  },
  dropdownItem: {
    width: '100%',
    padding: '10px 16px',
    border: 'none',
    background: 'transparent',
    color: '#fff',
    fontSize: '14px',
    textAlign: 'left' as const,
    cursor: 'pointer',
    fontFamily: 'sans-serif',
    whiteSpace: 'nowrap' as const,
  },
  autoRotateButton: {
    position: 'absolute',
    bottom: '20px',
    right: '20px',
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(10px)',
    transition: 'background 0.2s',
  },
  galaxySliderContainer: {
    position: 'absolute',
    bottom: '28px',
    right: '80px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  galaxySlider: {
    width: '100px',
    height: '4px',
    WebkitAppearance: 'none',
    appearance: 'none',
    background: '#333',
    borderRadius: '2px',
    outline: 'none',
    cursor: 'pointer',
  },
  infoButton: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    border: '1px solid #444',
    background: 'rgba(0,0,0,0.5)',
    color: '#888',
    fontSize: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arButton: {
    position: 'absolute',
    bottom: '20px',
    left: '20px',
    padding: '12px 20px',
    borderRadius: '24px',
    border: 'none',
    background: 'rgba(0,0,0,0.7)',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(10px)',
    fontSize: '14px',
    fontFamily: 'sans-serif',
    fontWeight: 500,
  },
  arButtonActive: {
    position: 'absolute',
    bottom: '20px',
    left: '20px',
    padding: '12px 24px',
    borderRadius: '24px',
    border: 'none',
    background: '#ff4444',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: 'sans-serif',
    fontWeight: 500,
  },
  arDebugPanel: {
    position: 'absolute',
    bottom: '80px',
    left: '20px',
    padding: '10px',
    borderRadius: '8px',
    background: 'rgba(0,0,0,0.8)',
    color: '#fff',
    fontSize: '11px',
    fontFamily: 'monospace',
    maxWidth: '280px',
    backdropFilter: 'blur(10px)',
  },
  storyModePlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0a0a0a',
    color: '#fff',
    fontFamily: 'sans-serif',
  },
  button: {
    marginTop: '20px',
    padding: '12px 24px',
    background: '#4488ff',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer',
  },
  }

export default AppLanding
