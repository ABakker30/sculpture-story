import * as THREE from 'three'

export interface CrossSectionIntersection {
  crossSectionName: string
  crossSectionIndex: number
  intersectionPoint: THREE.Vector3
  planeNormal: THREE.Vector3
  centroid: THREE.Vector3
  pathParameter: number
}

export interface DerivedGeometry {
  corners: THREE.Vector3[]
  curveSamples: THREE.Vector3[]
  latticeNodes: THREE.Vector3[]
  latticeSpheres: THREE.Mesh[]
  latticeSticks: THREE.Line[]
  stars: THREE.Group[]
  crossSectionIntersections: CrossSectionIntersection[]
}

export interface DerivationConfig {
  cornerAngleThreshold: number
  curveSampleCount: number
  latticeRadius: number
  starSize: number
  relaxFactor: number
}

const DEFAULT_CONFIG: DerivationConfig = {
  cornerAngleThreshold: 0.3,
  curveSampleCount: 100,
  latticeRadius: 0.05,
  starSize: 0.1,
  relaxFactor: 0.5,
}

export function extractVertices(object: THREE.Object3D): THREE.Vector3[] {
  const vertices: THREE.Vector3[] = []

  object.traverse((child) => {
    if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
      const geometry = child.geometry
      const position = geometry.getAttribute('position')
      
      if (position) {
        for (let i = 0; i < position.count; i++) {
          const v = new THREE.Vector3(
            position.getX(i),
            position.getY(i),
            position.getZ(i)
          )
          v.applyMatrix4(child.matrixWorld)
          vertices.push(v)
        }
      }
    }
  })

  return vertices
}

export function computeCorners(
  path: THREE.Vector3[],
  angleThreshold: number = DEFAULT_CONFIG.cornerAngleThreshold
): THREE.Vector3[] {
  if (path.length < 3) return [...path]

  const corners: THREE.Vector3[] = [path[0]]

  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]
    const curr = path[i]
    const next = path[i + 1]

    const v1 = new THREE.Vector3().subVectors(curr, prev).normalize()
    const v2 = new THREE.Vector3().subVectors(next, curr).normalize()
    
    const dot = v1.dot(v2)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

    if (angle > angleThreshold) {
      corners.push(curr.clone())
    }
  }

  corners.push(path[path.length - 1])
  return corners
}

export function sampleCurve(
  curveObject: THREE.Object3D | null,
  fallbackPath: THREE.Vector3[],
  sampleCount: number = DEFAULT_CONFIG.curveSampleCount
): THREE.Vector3[] {
  if (curveObject) {
    const vertices = extractVertices(curveObject)
    if (vertices.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(vertices)
      return curve.getPoints(sampleCount)
    }
  }

  if (fallbackPath.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(fallbackPath)
    return curve.getPoints(sampleCount)
  }

  return fallbackPath
}

export function relaxPath(
  polyline: THREE.Vector3[],
  curve: THREE.Vector3[],
  factor: number = DEFAULT_CONFIG.relaxFactor
): THREE.Vector3[] {
  if (polyline.length !== curve.length) {
    const resampledCurve = new THREE.CatmullRomCurve3(curve).getPoints(polyline.length - 1)
    return polyline.map((p, i) => {
      const c = resampledCurve[i] || p
      return new THREE.Vector3().lerpVectors(p, c, factor)
    })
  }

  return polyline.map((p, i) => {
    const c = curve[i]
    return new THREE.Vector3().lerpVectors(p, c, factor)
  })
}

export function generateLatticeFromCorners(
  corners: THREE.Vector3[],
  radius: number = DEFAULT_CONFIG.latticeRadius
): { nodes: THREE.Vector3[], spheres: THREE.Mesh[], sticks: THREE.Line[] } {
  const nodes = [...corners]
  const spheres: THREE.Mesh[] = []
  const sticks: THREE.Line[] = []

  const sphereGeometry = new THREE.SphereGeometry(radius, 16, 12)
  const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0x4488ff })

  for (const node of nodes) {
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
    sphere.position.copy(node)
    spheres.push(sphere)
  }

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x4488ff })

  for (let i = 0; i < nodes.length - 1; i++) {
    const geometry = new THREE.BufferGeometry().setFromPoints([nodes[i], nodes[i + 1]])
    const line = new THREE.Line(geometry, lineMaterial)
    sticks.push(line)
  }

  return { nodes, spheres, sticks }
}

export function generateStars(
  corners: THREE.Vector3[],
  size: number = DEFAULT_CONFIG.starSize
): THREE.Group[] {
  const stars: THREE.Group[] = []

  for (let i = 0; i < corners.length; i++) {
    const star = createStar(corners[i], size, i === 0 || i === corners.length - 1)
    stars.push(star)
  }

  return stars
}

function createStar(position: THREE.Vector3, size: number, isEndpoint: boolean): THREE.Group {
  const group = new THREE.Group()
  group.position.copy(position)

  const material = new THREE.LineBasicMaterial({ 
    color: isEndpoint ? 0xffaa00 : 0xff4400 
  })

  const directions = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ]

  for (const dir of directions) {
    const points = [
      new THREE.Vector3(0, 0, 0),
      dir.clone().multiplyScalar(size)
    ]
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.Line(geometry, material)
    group.add(line)
  }

  return group
}

export class GeometryDeriver {
  private config: DerivationConfig
  private derived: DerivedGeometry | null = null

  constructor(config: Partial<DerivationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  derive(
    pathObject: THREE.Object3D,
    curveObject: THREE.Object3D | null
  ): DerivedGeometry {
    const pathVertices = extractVertices(pathObject)
    
    const corners = computeCorners(pathVertices, this.config.cornerAngleThreshold)
    const curveSamples = sampleCurve(curveObject, pathVertices, this.config.curveSampleCount)
    
    const lattice = generateLatticeFromCorners(corners, this.config.latticeRadius)
    const stars = generateStars(corners, this.config.starSize)

    this.derived = {
      corners,
      curveSamples,
      latticeNodes: lattice.nodes,
      latticeSpheres: lattice.spheres,
      latticeSticks: lattice.sticks,
      stars,
      crossSectionIntersections: [],
    }

    return this.derived
  }

  getDerived(): DerivedGeometry | null {
    return this.derived
  }

  computeIntersections(
    pathOrCurve: THREE.Vector3[],
    crossSections: Map<string, THREE.Vector3[]>
  ): CrossSectionIntersection[] {
    const intersections = computeCrossSectionIntersections(pathOrCurve, crossSections)
    
    if (this.derived) {
      this.derived.crossSectionIntersections = intersections
    }
    
    return intersections
  }

  getIntersections(): CrossSectionIntersection[] {
    return this.derived?.crossSectionIntersections ?? []
  }

  updateConfig(config: Partial<DerivationConfig>): void {
    this.config = { ...this.config, ...config }
  }

  dispose(): void {
    if (this.derived) {
      for (const sphere of this.derived.latticeSpheres) {
        sphere.geometry.dispose()
        if (sphere.material instanceof THREE.Material) {
          sphere.material.dispose()
        }
      }
      for (const stick of this.derived.latticeSticks) {
        stick.geometry.dispose()
        if (stick.material instanceof THREE.Material) {
          stick.material.dispose()
        }
      }
      for (const star of this.derived.stars) {
        star.traverse((obj) => {
          if (obj instanceof THREE.Line) {
            obj.geometry.dispose()
            if (obj.material instanceof THREE.Material) {
              obj.material.dispose()
            }
          }
        })
      }
      this.derived = null
    }
  }
}

export function computeCrossSectionPlane(
  crossSectionVertices: THREE.Vector3[]
): { centroid: THREE.Vector3; normal: THREE.Vector3 } | null {
  if (crossSectionVertices.length < 3) return null

  const centroid = new THREE.Vector3()
  for (const v of crossSectionVertices) {
    centroid.add(v)
  }
  centroid.divideScalar(crossSectionVertices.length)

  const v0 = crossSectionVertices[0]
  const v1 = crossSectionVertices[Math.floor(crossSectionVertices.length / 3)]
  const v2 = crossSectionVertices[Math.floor(crossSectionVertices.length * 2 / 3)]

  const edge1 = new THREE.Vector3().subVectors(v1, v0)
  const edge2 = new THREE.Vector3().subVectors(v2, v0)
  const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize()

  if (normal.lengthSq() < 0.0001) return null

  return { centroid, normal }
}

export function findPlaneLineIntersection(
  planePoint: THREE.Vector3,
  planeNormal: THREE.Vector3,
  linePoints: THREE.Vector3[]
): { point: THREE.Vector3; parameter: number } | null {
  if (linePoints.length < 2) return null

  let bestIntersection: { point: THREE.Vector3; parameter: number; distance: number } | null = null

  for (let i = 0; i < linePoints.length - 1; i++) {
    const p0 = linePoints[i]
    const p1 = linePoints[i + 1]
    const lineDir = new THREE.Vector3().subVectors(p1, p0)
    const lineLength = lineDir.length()
    if (lineLength < 0.0001) continue
    lineDir.normalize()

    const denom = planeNormal.dot(lineDir)
    if (Math.abs(denom) < 0.0001) continue

    const t = planeNormal.dot(new THREE.Vector3().subVectors(planePoint, p0)) / denom

    if (t >= 0 && t <= lineLength) {
      const intersection = new THREE.Vector3().copy(p0).addScaledVector(lineDir, t)
      const distToPlanePoint = intersection.distanceTo(planePoint)

      const globalT = (i + t / lineLength) / (linePoints.length - 1)

      if (!bestIntersection || distToPlanePoint < bestIntersection.distance) {
        bestIntersection = { point: intersection, parameter: globalT, distance: distToPlanePoint }
      }
    }
  }

  return bestIntersection ? { point: bestIntersection.point, parameter: bestIntersection.parameter } : null
}

export function computeCrossSectionIntersections(
  pathOrCurve: THREE.Vector3[],
  crossSections: Map<string, THREE.Vector3[]>
): CrossSectionIntersection[] {
  const intersections: CrossSectionIntersection[] = []

  const sortedNames = Array.from(crossSections.keys()).sort((a, b) => {
    const numA = parseInt(a.replace('CROSS_SECTION_', ''), 10)
    const numB = parseInt(b.replace('CROSS_SECTION_', ''), 10)
    return numA - numB
  })

  for (let idx = 0; idx < sortedNames.length; idx++) {
    const name = sortedNames[idx]
    const vertices = crossSections.get(name)!
    const plane = computeCrossSectionPlane(vertices)

    if (!plane) {
      console.warn(`[GeometryDerivation] Could not compute plane for ${name}`)
      continue
    }

    const intersection = findPlaneLineIntersection(plane.centroid, plane.normal, pathOrCurve)

    if (intersection) {
      intersections.push({
        crossSectionName: name,
        crossSectionIndex: idx,
        intersectionPoint: intersection.point,
        planeNormal: plane.normal,
        centroid: plane.centroid,
        pathParameter: intersection.parameter
      })
    } else {
      intersections.push({
        crossSectionName: name,
        crossSectionIndex: idx,
        intersectionPoint: plane.centroid.clone(),
        planeNormal: plane.normal,
        centroid: plane.centroid,
        pathParameter: idx / (sortedNames.length - 1)
      })
    }
  }

  console.info(`[GeometryDerivation] Computed ${intersections.length} cross-section intersections`)
  console.info(`[GeometryDerivation] Expected: ${crossSections.size}, Found: ${intersections.length}`)
  
  if (intersections.length === crossSections.size) {
    console.info(`[GeometryDerivation] ✓ Intersection count matches cross-section count`)
  } else {
    console.warn(`[GeometryDerivation] ✗ Intersection count mismatch`)
  }

  return intersections
}

export const geometryDeriver = new GeometryDeriver()
export default geometryDeriver
