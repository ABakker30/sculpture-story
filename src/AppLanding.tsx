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
import presetCapture from './engine/PresetCapture'
import modeController, { AppMode } from './engine/ModeController'

import LightingModal from './ui/LightingModal'
import MaterialModal from './ui/MaterialModal'

interface DebugSceneProps {
  loftProgress: number
  straighten: number
  onLoaded: () => void
  autoRotate: boolean
  rotateSpeed: number
  sphereRadius: number
  starDensity: number
}

function DebugLoftScene({ loftProgress, straighten, onLoaded, autoRotate, rotateSpeed, sphereRadius, starDensity }: DebugSceneProps) {
  const { scene, gl, camera } = useThree()
  const meshRef = useRef<THREE.Mesh | null>(null)
  const crossSectionsRef = useRef<THREE.Group | null>(null)
  const spheresRef = useRef<THREE.Group | null>(null)
  const starsRef = useRef<THREE.Group | null>(null)
  const starPositionsRef = useRef<THREE.Vector3[]>([])
  const dataRef = useRef<{
    sortedSections: THREE.Vector3[][]
    sortedNames: string[]
    pathCorners: THREE.Vector3[]
    centroids: THREE.Vector3[]
    boundingSphere: THREE.Sphere
  } | null>(null)
  const controlsRef = useRef<any>(null)
  const [initialized, setInitialized] = useState(false)

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
      
      // Pre-generate random star positions (10x bounding sphere, 50x corner count)
      const maxStars = pathCorners.length * 50
      const starRadius = boundingSphere.radius * 10
      starPositionsRef.current = Array.from({ length: maxStars }, () => {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        const r = Math.cbrt(Math.random()) * starRadius // cube root for uniform volume distribution
        return new THREE.Vector3(
          boundingSphere.center.x + r * Math.sin(phi) * Math.cos(theta),
          boundingSphere.center.y + r * Math.sin(phi) * Math.sin(theta),
          boundingSphere.center.z + r * Math.cos(phi)
        )
      })
      
      dataRef.current = { sortedSections, sortedNames, pathCorners, centroids, boundingSphere }
      
      console.info(`[DEBUG] Loaded ${sortedNames.length} cross-sections`)
      console.info(`[DEBUG] Path corners: ${pathCorners.length} unique vertices`)
      console.info(`[DEBUG] Bounding sphere radius: ${boundingSphere.radius.toFixed(2)}, max stars: ${maxStars}`)
      
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
      if (starsRef.current) scene.remove(starsRef.current)
    }
  }, [scene, gl, camera, onLoaded])

  // Galaxy stars effect
  useEffect(() => {
    if (!initialized || !dataRef.current) return
    
    if (starsRef.current) {
      scene.remove(starsRef.current)
      starsRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose()
      })
    }
    
    if (starDensity <= 0) {
      starsRef.current = null
      return
    }
    
    const { pathCorners } = dataRef.current
    const maxStars = pathCorners.length * 50
    const numStars = Math.floor(starDensity * maxStars)
    
    // Star size scales with density, max 80% of corner sphere radius
    const maxStarSize = sphereRadius * 0.8
    const starSize = starDensity * maxStarSize
    
    if (numStars === 0 || starSize <= 0) {
      starsRef.current = null
      return
    }
    
    const starsGroup = new THREE.Group()
    starsGroup.name = 'GALAXY_STARS'
    
    const starGeo = new THREE.SphereGeometry(starSize, 32, 24)
    
    for (let i = 0; i < numStars; i++) {
      const star = new THREE.Mesh(starGeo, materialController.getMaterial())
      star.position.copy(starPositionsRef.current[i])
      starsGroup.add(star)
    }
    
    scene.add(starsGroup)
    starsRef.current = starsGroup
    
  }, [starDensity, sphereRadius, initialized, scene])

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
    
    const sphereGeo = new THREE.SphereGeometry(sphereRadius, 32, 24)
    
    pathCorners.forEach(pos => {
      const sphere = new THREE.Mesh(sphereGeo, materialController.getMaterial())
      sphere.position.copy(pos)
      sphereGroup.add(sphere)
    })
    
    console.info(`[DEBUG] Showing ${pathCorners.length} path corner spheres`)
    
    scene.add(sphereGroup)
    spheresRef.current = sphereGroup
    
  }, [sphereRadius, initialized, scene])

  useEffect(() => {
    if (!initialized || !dataRef.current) return
    
    const { sortedSections, centroids, pathCorners } = dataRef.current
    
    if (meshRef.current) {
      scene.remove(meshRef.current)
      meshRef.current.geometry.dispose()
    }
    
    // Scale factor: 0 = full size (1.0), 1 = invisible (0)
    const scale = 1.0 - loftProgress
    
    // Straighten: interpolate centroids toward polylinear path between corners
    const straightenedCentroids = centroids.map((centroid, i) => {
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
    const circleBlend = loftProgress // 0 = original shape, 1 = circle
    const numVerts = 32
    
    const transformedSections = sortedSections.map((section, i) => {
      const originalCentroid = centroids[i]
      const newCentroid = straightenedCentroids[i]
      
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
        // Offset by centroid movement from straightening
        scaledOriginal.add(new THREE.Vector3().subVectors(newCentroid, originalCentroid))
        
        // Blend between original shape and circle
        return new THREE.Vector3().lerpVectors(scaledOriginal, circlePoint, circleBlend)
      })
    })
    
    const geometry = createLoftGeometry(transformedSections)
    geometry.computeVertexNormals()
    
    const mesh = new THREE.Mesh(geometry, materialController.getMaterial())
    mesh.name = 'DEBUG_LOFT_MESH'
    scene.add(mesh)
    meshRef.current = mesh
    
  }, [loftProgress, straighten, initialized, scene])

  useFrame(() => {
    if (controlsRef.current) controlsRef.current.update()
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

function normalizeSections(sections: THREE.Vector3[][]): THREE.Vector3[][] {
  const maxVerts = Math.max(...sections.map(s => s.length))
  const target = Math.max(maxVerts, 32)
  
  return sections.map(section => {
    if (section.length === target) return section
    const resampled: THREE.Vector3[] = []
    for (let i = 0; i < target; i++) {
      const t = i / target
      const srcIdx = t * section.length
      const i0 = Math.floor(srcIdx) % section.length
      const i1 = (i0 + 1) % section.length
      const frac = srcIdx - Math.floor(srcIdx)
      resampled.push(new THREE.Vector3().lerpVectors(section[i0], section[i1], frac))
    }
    return resampled
  })
}

function createLoftGeometry(sections: THREE.Vector3[][]): THREE.BufferGeometry {
  const vps = sections[0].length
  const positions: number[] = []
  const indices: number[] = []
  
  for (const section of sections) {
    for (const v of section) {
      positions.push(v.x, v.y, v.z)
    }
  }
  
  for (let s = 0; s < sections.length - 1; s++) {
    for (let i = 0; i < vps - 1; i++) {
      const c = s * vps + i
      indices.push(c, (s + 1) * vps + i, c + 1)
      indices.push(c + 1, (s + 1) * vps + i, (s + 1) * vps + i + 1)
    }
    const last = vps - 1
    const c = s * vps + last
    indices.push(c, (s + 1) * vps + last, s * vps)
    indices.push(s * vps, (s + 1) * vps + last, (s + 1) * vps)
  }
  
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
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

  useFrame((_, delta) => {
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
  const [lightingModalOpen, setLightingModalOpen] = useState(false)
  const [materialModalOpen, setMaterialModalOpen] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [rotateSpeed, setRotateSpeed] = useState(0.5)
  const [mode, setMode] = useState<AppMode>(modeController.getMode())
  const [sculptureLoaded, setSculptureLoaded] = useState(false)
  const [loftProgress, setLoftProgress] = useState(0)
  const [straighten, setStraighten] = useState(0)
  const [sphereRadius, setSphereRadius] = useState(0)
  const [starDensity, setStarDensity] = useState(0)
  const [debugMode] = useState(true)

  useEffect(() => {
    const unsubscribe = modeController.subscribe(setMode)
    return unsubscribe
  }, [])

  const handleSculptureLoaded = useCallback(() => {
    setSculptureLoaded(true)
  }, [])

  const handleAutoRotateToggle = () => {
    const newValue = !autoRotate
    setAutoRotate(newValue)
    cameraController.setAutoRotate(newValue)
  }

  const handleCopyPreset = () => {
    presetCapture.copyPresetToClipboard('Custom Preset')
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
        camera={{ position: [20, 15, 20], fov: 40 }}
        gl={{ 
          antialias: true, 
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
        style={{ background: '#0a0a0a' }}
      >
        {debugMode ? (
          <DebugLoftScene loftProgress={loftProgress} straighten={straighten} onLoaded={handleSculptureLoaded} autoRotate={autoRotate} rotateSpeed={rotateSpeed} sphereRadius={sphereRadius} starDensity={starDensity} />
        ) : (
          <SculptureScene onSculptureLoaded={handleSculptureLoaded} />
        )}
      </Canvas>

      {debugMode && (
        <div style={styles.debugPanel}>
          <h3 style={{ margin: '0 0 16px 0', color: '#fff' }}>Debug Controls</h3>
          
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '8px' }}>Scale to Heartline</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: '#888', fontSize: '12px' }}>Full</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={loftProgress}
                onChange={(e) => setLoftProgress(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '12px' }}>Core</span>
            </div>
            <div style={{ marginTop: '4px', color: '#fff', fontSize: '13px' }}>
              Scale: <strong>{((1.0 - loftProgress * 0.975) * 100).toFixed(1)}%</strong>
            </div>
          </div>
          
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '8px' }}>Straighten to Polyline</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: '#888', fontSize: '12px' }}>Curve</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={straighten}
                onChange={(e) => setStraighten(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '12px' }}>Stick</span>
            </div>
            <div style={{ marginTop: '4px', color: '#fff', fontSize: '13px' }}>
              Straighten: <strong>{(straighten * 100).toFixed(0)}%</strong>
            </div>
          </div>
          
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '8px' }}>Corner Spheres</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: '#888', fontSize: '12px' }}>Off</span>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={sphereRadius}
                onChange={(e) => setSphereRadius(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '12px' }}>Large</span>
            </div>
            <div style={{ marginTop: '4px', color: '#fff', fontSize: '13px' }}>
              Radius: <strong>{sphereRadius > 0 ? sphereRadius.toFixed(2) : 'Off'}</strong>
            </div>
          </div>
          
          <div>
            <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '8px' }}>Galaxy Stars</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: '#888', fontSize: '12px' }}>None</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={starDensity}
                onChange={(e) => setStarDensity(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '12px' }}>Max</span>
            </div>
            <div style={{ marginTop: '4px', color: '#fff', fontSize: '13px' }}>
              Density: <strong>{(starDensity * 100).toFixed(0)}%</strong>
            </div>
          </div>
          
          <div>
            <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '8px' }}>Rotation Speed</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: '#888', fontSize: '12px' }}>Slow</span>
              <input
                type="range"
                min={0}
                max={1.25}
                step={0.025}
                value={rotateSpeed}
                onChange={(e) => setRotateSpeed(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#888', fontSize: '12px' }}>Fast</span>
            </div>
            <div style={{ marginTop: '4px', color: '#fff', fontSize: '13px' }}>
              Speed: <strong>{rotateSpeed.toFixed(1)}</strong>
            </div>
          </div>
        </div>
      )}

      <div style={styles.toolbar}>
        <button
          style={styles.toolbarButton}
          onClick={() => setLightingModalOpen(true)}
          title="Lighting Controls"
        >
          💡
        </button>
        <button
          style={styles.toolbarButton}
          onClick={() => setMaterialModalOpen(true)}
          title="Material Controls"
        >
          🎨
        </button>
        <button
          style={{ ...styles.toolbarButton, background: autoRotate ? '#4488ff' : undefined }}
          onClick={handleAutoRotateToggle}
          title="Auto Rotate"
        >
          🔄
        </button>
        <button
          style={styles.toolbarButton}
          onClick={handleCopyPreset}
          title="Copy Preset to Clipboard"
        >
          📋
        </button>
      </div>

      <div style={styles.info}>
        <h2 style={styles.infoTitle}>Sculpture Story</h2>
        {sculptureLoaded ? (
          <p style={styles.infoText}>Orbit to explore • Use controls to experiment</p>
        ) : (
          <p style={styles.infoText}>Loading sculpture...</p>
        )}
      </div>

      <LightingModal
        isOpen={lightingModalOpen}
        onClose={() => setLightingModalOpen(false)}
      />

      <MaterialModal
        isOpen={materialModalOpen}
        onClose={() => setMaterialModalOpen(false)}
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
  toolbar: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    display: 'flex',
    gap: '8px',
  },
  toolbarButton: {
    width: '44px',
    height: '44px',
    borderRadius: '8px',
    border: 'none',
    background: 'rgba(0,0,0,0.7)',
    color: '#fff',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(10px)',
    transition: 'background 0.2s',
  },
  info: {
    position: 'absolute',
    bottom: '30px',
    left: '30px',
  },
  infoTitle: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 300,
    color: '#fff',
    letterSpacing: '2px',
  },
  infoText: {
    margin: '8px 0 0 0',
    fontSize: '14px',
    color: '#888',
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
    top: '20px',
    left: '20px',
    background: 'rgba(0,0,0,0.85)',
    padding: '16px 20px',
    borderRadius: '10px',
    minWidth: '280px',
    fontFamily: 'sans-serif',
  },
}

export default AppLanding
