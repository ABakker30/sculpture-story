import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import objLoader, { ParsedOBJData, OBJValidationResult } from './OBJLoader'
import { computeCrossSectionIntersections, CrossSectionIntersection } from './GeometryDerivation'

const COLORS = {
  SCULPTURE_PATH: 0x00ff00,
  SCULPTURE_CURVE: 0x0088ff,
  CROSS_SECTION: 0xff8800,
}

interface VerificationState {
  loading: boolean
  loaded: boolean
  error: string | null
  validation: OBJValidationResult | null
  intersectionCount: number
}

export function OBJTestVerification() {
  const { scene } = useThree()
  const [, setState] = useState<VerificationState>({
    loading: true,
    loaded: false,
    error: null,
    validation: null,
    intersectionCount: 0
  })
  const [geometryGroup, setGeometryGroup] = useState<THREE.Group | null>(null)

  useEffect(() => {
    async function loadAndVerify() {
      try {
        console.info('[OBJTestVerification] Starting OBJ load test...')
        
        const data = await objLoader.load('/grasshopper-data/sculpture.obj')
        const validation = objLoader.validate(data)
        
        const pathOrCurve = data.sculptureCurve && data.sculptureCurve.length > 0 
          ? data.sculptureCurve 
          : data.sculpturePath
        
        let intersections: CrossSectionIntersection[] = []
        if (pathOrCurve && pathOrCurve.length > 0) {
          intersections = computeCrossSectionIntersections(pathOrCurve, data.crossSections)
        }

        const group = createVerificationGeometry(data, intersections)
        scene.add(group)
        setGeometryGroup(group)

        setState({
          loading: false,
          loaded: true,
          error: null,
          validation,
          intersectionCount: intersections.length
        })

        console.info('[OBJTestVerification] ✓ OBJ loaded and verified successfully')
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error('[OBJTestVerification] ✗ Failed to load OBJ:', errorMsg)
        setState({
          loading: false,
          loaded: false,
          error: errorMsg,
          validation: null,
          intersectionCount: 0
        })
      }
    }

    loadAndVerify()

    return () => {
      if (geometryGroup) {
        scene.remove(geometryGroup)
        disposeGroup(geometryGroup)
      }
    }
  }, [scene])

  return null
}

function createVerificationGeometry(data: ParsedOBJData, intersections: CrossSectionIntersection[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'OBJ_VERIFICATION_GROUP'

  if (data.sculpturePath && data.sculpturePath.length > 0) {
    const pathGeometry = new THREE.BufferGeometry().setFromPoints(data.sculpturePath)
    const pathMaterial = new THREE.LineBasicMaterial({ 
      color: COLORS.SCULPTURE_PATH, 
      linewidth: 3 
    })
    const pathLine = new THREE.Line(pathGeometry, pathMaterial)
    pathLine.name = 'VERIFY_SCULPTURE_PATH'
    group.add(pathLine)

    const sphereGeom = new THREE.SphereGeometry(0.15)
    const sphereMat = new THREE.MeshBasicMaterial({ color: COLORS.SCULPTURE_PATH })
    data.sculpturePath.forEach((v, i) => {
      const sphere = new THREE.Mesh(sphereGeom, sphereMat)
      sphere.position.copy(v)
      sphere.name = `PATH_VERTEX_${i}`
      group.add(sphere)
    })

    console.info(`[Verification] SCULPTURE_PATH: ${data.sculpturePath.length} vertices (GREEN)`)
  }

  if (data.sculptureCurve && data.sculptureCurve.length > 0) {
    const curveGeometry = new THREE.BufferGeometry().setFromPoints(data.sculptureCurve)
    const curveMaterial = new THREE.LineBasicMaterial({ 
      color: COLORS.SCULPTURE_CURVE, 
      linewidth: 2,
      transparent: true,
      opacity: 0.7
    })
    const curveLine = new THREE.Line(curveGeometry, curveMaterial)
    curveLine.name = 'VERIFY_SCULPTURE_CURVE'
    group.add(curveLine)

    console.info(`[Verification] SCULPTURE_CURVE: ${data.sculptureCurve.length} vertices (BLUE)`)
  }

  let crossSectionIndex = 0
  const crossSectionNames = Array.from(data.crossSections.keys()).sort()
  
  for (const name of crossSectionNames) {
    const vertices = data.crossSections.get(name)
    if (!vertices || vertices.length === 0) continue

    const hue = (crossSectionIndex / crossSectionNames.length) * 0.15 + 0.05
    const color = new THREE.Color().setHSL(hue, 1, 0.5)

    const sectionGeometry = new THREE.BufferGeometry().setFromPoints(vertices)
    const sectionMaterial = new THREE.LineBasicMaterial({ 
      color: color,
      transparent: true,
      opacity: 0.6
    })
    const sectionLine = new THREE.LineLoop(sectionGeometry, sectionMaterial)
    sectionLine.name = `VERIFY_${name}`
    group.add(sectionLine)

    crossSectionIndex++
  }

  console.info(`[Verification] Cross-sections: ${crossSectionNames.length} (ORANGE gradient)`)
  console.info(`[Verification] Cross-section names: ${crossSectionNames[0]} to ${crossSectionNames[crossSectionNames.length - 1]}`)

  if (intersections.length > 0) {
    const intersectionSphereGeom = new THREE.SphereGeometry(0.2)
    const intersectionSphereMat = new THREE.MeshBasicMaterial({ color: 0xff00ff })
    
    for (const intersection of intersections) {
      const sphere = new THREE.Mesh(intersectionSphereGeom, intersectionSphereMat)
      sphere.position.copy(intersection.intersectionPoint)
      sphere.name = `INTERSECTION_${intersection.crossSectionName}`
      group.add(sphere)
    }
    
    console.info(`[Verification] Intersection points: ${intersections.length} (MAGENTA spheres)`)
    console.info(`[Verification] First intersection at: (${intersections[0].intersectionPoint.x.toFixed(2)}, ${intersections[0].intersectionPoint.y.toFixed(2)}, ${intersections[0].intersectionPoint.z.toFixed(2)})`)
    console.info(`[Verification] Last intersection at: (${intersections[intersections.length - 1].intersectionPoint.x.toFixed(2)}, ${intersections[intersections.length - 1].intersectionPoint.y.toFixed(2)}, ${intersections[intersections.length - 1].intersectionPoint.z.toFixed(2)})`)
  }

  return group
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry.dispose()
      if (obj.material instanceof THREE.Material) {
        obj.material.dispose()
      }
    }
  })
}

export function OBJVerificationOverlay({ validation }: { validation: OBJValidationResult | null }) {
  if (!validation) return null

  return (
    <div style={overlayStyles.container}>
      <h3 style={overlayStyles.title}>OBJ Verification</h3>
      <div style={overlayStyles.row}>
        <span>SCULPTURE_PATH:</span>
        <span style={{ color: validation.hasSculpturePath ? '#0f0' : '#f00' }}>
          {validation.hasSculpturePath ? '✓' : '✗'}
        </span>
      </div>
      <div style={overlayStyles.row}>
        <span>SCULPTURE_CURVE:</span>
        <span style={{ color: validation.hasSculptureCurve ? '#0f0' : '#888' }}>
          {validation.hasSculptureCurve ? '✓' : '(optional)'}
        </span>
      </div>
      <div style={overlayStyles.row}>
        <span>Cross-sections:</span>
        <span style={{ color: validation.crossSectionCount > 0 ? '#0f0' : '#f00' }}>
          {validation.crossSectionCount}
        </span>
      </div>
      <div style={{ ...overlayStyles.row, marginTop: '8px', fontWeight: 'bold' }}>
        <span>Status:</span>
        <span style={{ color: validation.valid ? '#0f0' : '#f00' }}>
          {validation.valid ? 'VALID ✓' : 'INVALID ✗'}
        </span>
      </div>
    </div>
  )
}

const overlayStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: '20px',
    left: '20px',
    background: 'rgba(0,0,0,0.8)',
    padding: '16px',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '14px',
    color: '#fff',
    minWidth: '220px',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '16px',
    borderBottom: '1px solid #444',
    paddingBottom: '8px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
}

export default OBJTestVerification
