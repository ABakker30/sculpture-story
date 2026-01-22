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

function DebugLoftScene({ loftProgress, straighten, onLoaded, autoRotate, rotateSpeed, sphereRadius, starDensity, cosmicScale, bondDensity, starScale, galaxySize, cameraViewpoint, cameraFov, useGpu, onCameraViewpointsComputed, smoothCameraAnim, onSmoothAnimComplete, showHull }: DebugSceneProps) {
  const { scene, gl, camera } = useThree()
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
    
  }, [loftProgress, straighten, initialized, scene])

  useFrame((_, delta) => {
    if (controlsRef.current) controlsRef.current.update()
    
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
  const [debugPanelOpen, setDebugPanelOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
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
  const [rotateSpeed, setRotateSpeed] = useState(0.5)
  const [mode, setMode] = useState<AppMode>(modeController.getMode())
  const [_sculptureLoaded, setSculptureLoaded] = useState(false)
  const [loftProgress, setLoftProgress] = useState(0)
  const [straighten, setStraighten] = useState(0)
  const [sphereRadius, setSphereRadius] = useState(0)
  const [starDensity, setStarDensity] = useState(0)
  const [cosmicScale, setCosmicScale] = useState(0)
  const [bondDensity, setBondDensity] = useState(0)
  const [starScale, setStarScale] = useState(0.1)
  const [galaxySize, setGalaxySize] = useState(4)
  const [cameraViewpoint, setCameraViewpoint] = useState(-1)
  const [cameraViewpoints, setCameraViewpoints] = useState<CameraViewpoint[]>([])
  const [lensLength, setLensLength] = useState(100) // mm equivalent
  const [webgpuSupported, setWebgpuSupported] = useState<boolean | null>(null)
  const [rendererInfo, setRendererInfo] = useState<{ vendor: string; renderer: string; webglVersion: string } | null>(null)
  const [debugMode] = useState(true)
  
  // AR state
  const [arSupported, setArSupported] = useState(false)
  const [arActive, setArActive] = useState(false)
  const arControllerRef = useRef<ARController | null>(null)
  
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
    const arController = new ARController({
      onSessionStart: () => setArActive(true),
      onSessionEnd: () => setArActive(false),
      onError: (err) => console.error('[AR] Error:', err)
    })
    arControllerRef.current = arController
    arController.isARSupported().then((supported) => {
      console.info(`[AR] Support check result: ${supported}, navigator.xr exists: ${!!navigator.xr}`)
      setArSupported(supported)
    })
  }, [])

  const handleEnterAR = async () => {
    if (!arControllerRef.current) return
    const success = await arControllerRef.current.startARSession()
    if (!success) {
      console.warn('[AR] Failed to start AR session')
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
        }}
        style={{ background: '#0a0a0a' }}
        onCreated={({ gl }: { gl: THREE.WebGLRenderer }) => {
          const info = getRendererInfo(gl)
          setRendererInfo(info)
          console.info(`[Renderer] ${info.webglVersion} - ${info.renderer}`)
        }}
      >
        {debugMode ? (
          <DebugLoftScene loftProgress={loftProgress} straighten={straighten} onLoaded={handleSculptureLoaded} autoRotate={autoRotate} rotateSpeed={rotateSpeed} sphereRadius={sphereRadius} starDensity={starDensity} cosmicScale={cosmicScale} bondDensity={bondDensity} starScale={starScale} galaxySize={galaxySize} cameraViewpoint={cameraViewpoint} cameraFov={cameraFov} useGpu={webgpuSupported === true} onCameraViewpointsComputed={setCameraViewpoints} smoothCameraAnim={smoothCameraAnim} onSmoothAnimComplete={handleSmoothAnimComplete} showHull={showHull} />
        ) : (
          <SculptureScene onSculptureLoaded={handleSculptureLoaded} />
        )}
      </Canvas>

      {debugMode && debugPanelOpen && (
        <div style={styles.debugPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ margin: 0, color: '#fff', fontSize: '11px' }}>Debug Controls</h3>
            <button 
              onClick={() => setDebugPanelOpen(false)} 
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
            >✕</button>
          </div>
          
          {rendererInfo && (
            <div style={{ marginBottom: '6px', padding: '6px', background: '#1a1a1a', borderRadius: '4px', fontSize: '11px' }}>
              <div style={{ color: '#4a9eff', marginBottom: '2px' }}>
                {rendererInfo.webglVersion} {webgpuSupported ? '• WebGPU Ready' : ''}
              </div>
              <div style={{ color: '#888', fontSize: '12px', wordBreak: 'break-word' }}>
                {rendererInfo.renderer}
              </div>
            </div>
          )}
          
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Scale to Heartline</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>Full</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={loftProgress}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] loftProgress = ${v}`); setLoftProgress(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>Core</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Scale: <strong>{((1.0 - loftProgress * 0.975) * 100).toFixed(1)}%</strong>
            </div>
          </div>
          
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Straighten to Polyline</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>Curve</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={straighten}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] straighten = ${v}`); setStraighten(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>Stick</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Straighten: <strong>{(straighten * 100).toFixed(0)}%</strong>
            </div>
          </div>
          
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Corner Spheres</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>Off</span>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={sphereRadius}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] sphereRadius = ${v}`); setSphereRadius(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>Large</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Radius: <strong>{sphereRadius > 0 ? sphereRadius.toFixed(2) : 'Off'}</strong>
            </div>
          </div>
          
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Galaxy Stars</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>None</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={starDensity}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] starDensity = ${v}`); setStarDensity(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>Max</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Density: <strong>{(starDensity * 100).toFixed(0)}%</strong>
            </div>
          </div>
          
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Galaxy Size</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>1x</span>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={galaxySize}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] galaxySize = ${v}`); setGalaxySize(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>10x</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Size: <strong>{galaxySize.toFixed(1)}x</strong> radius
            </div>
          </div>
          
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Star Scaler</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>Tiny</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={starScale}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] starScale = ${v}`); setStarScale(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>Touch</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Scale: <strong>{(starScale * 100).toFixed(0)}%</strong>
            </div>
          </div>
          
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Cosmic Scaler</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>Cosmic</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={cosmicScale}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] cosmicScale = ${v}`); setCosmicScale(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>Atomic</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Lattice: <strong>{(cosmicScale * 100).toFixed(0)}%</strong>
            </div>
          </div>
          
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Atom Bonds</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>None</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={bondDensity}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] bondDensity = ${v}`); setBondDensity(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>Full</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Bonds: <strong>{bondDensity > 0 ? `${(bondDensity * 100).toFixed(0)}%` : 'Off'}</strong>
            </div>
          </div>
          
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Rotation Speed</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>Slow</span>
              <input
                type="range"
                min={0}
                max={1.25}
                step={0.005}
                value={rotateSpeed}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] rotateSpeed = ${v}`); setRotateSpeed(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>Fast</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Speed: <strong>{rotateSpeed.toFixed(3)}</strong>
            </div>
          </div>
          
          {cameraViewpoints.length > 0 && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Camera Viewpoint</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>Free</span>
                <input
                  type="range"
                  min={-1}
                  max={cameraViewpoints.length - 1}
                  step={1}
                  value={cameraViewpoint}
                  onChange={(e) => { const v = parseInt(e.target.value); console.log(`[Tools] cameraViewpoint = ${v}`); setCameraViewpoint(v); }}
                  style={{ flex: 1 }}
                />
                <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>{cameraViewpoints.length}</span>
              </div>
              <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
                {cameraViewpoint < 0 ? (
                  <span>Mode: <strong>Free Camera</strong></span>
                ) : (
                  <span>
                    <strong>{cameraViewpoints[cameraViewpoint]?.label}</strong>
                    <span style={{ color: '#888', marginLeft: '6px', fontSize: '11px' }}>({cameraViewpoints[cameraViewpoint]?.type})</span>
                  </span>
                )}
              </div>
            </div>
          )}
          
          <div>
            <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>Camera Lens</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px' }}>20mm</span>
              <input
                type="range"
                min={20}
                max={300}
                step={5}
                value={lensLength}
                onChange={(e) => { const v = parseFloat(e.target.value); console.log(`[Tools] lensLength = ${v}`); setLensLength(v); }}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '11px', minWidth: '28px', textAlign: 'right' }}>300mm</span>
            </div>
            <div style={{ marginTop: '2px', color: '#fff', fontSize: '11px' }}>
              Lens: <strong>{lensLength}mm</strong>
              <span style={{ color: '#888', marginLeft: '6px', fontSize: '11px' }}>(FOV {cameraFov.toFixed(1)}°)</span>
            </div>
          </div>
        </div>
      )}

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
            <button
              style={styles.dropdownItem}
              onClick={() => { setSettingsModalOpen(true); setMenuOpen(false); }}
            >
              Settings
            </button>
            {debugMode && (
              <button
                style={styles.dropdownItem}
                onClick={() => { setDebugPanelOpen(!debugPanelOpen); setMenuOpen(false); }}
              >
                Tools
              </button>
            )}
          </div>
        )}
      </div>

      {/* Auto-rotate triangle button bottom right */}
      <button
        style={{ ...styles.autoRotateButton, background: autoRotate ? '#4488ff' : 'rgba(0,0,0,0.7)' }}
        onClick={handleAutoRotateToggle}
        title="Auto Rotate"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>

      {/* Enter AR button - only show if AR is supported */}
      {arSupported && !arActive && (
        <button
          style={styles.arButton}
          onClick={handleEnterAR}
          title="Enter AR"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 4v6h2V6h4V4H3zm18 0h-6v2h4v4h2V4zM3 14v6h6v-2H5v-4H3zm18 0v4h-4v2h6v-6h-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span style={{ marginLeft: '8px' }}>AR</span>
        </button>
      )}

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
  debugPanel: {
    position: 'absolute',
    top: '10px',
    left: '10px',
    background: 'rgba(0,0,0,0.85)',
    padding: '8px 12px',
    borderRadius: '6px',
    width: '220px',
    fontFamily: 'sans-serif',
    fontSize: '12px',
  },
}

export default AppLanding
