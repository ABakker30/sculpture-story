import * as THREE from 'three'
import { CrossSectionIntersection } from './GeometryDerivation'

export interface SculptureConfig {
  capEnds: boolean
  closedLoft: boolean
  smoothNormals: boolean
  subdivisions: number
}

const DEFAULT_CONFIG: SculptureConfig = {
  capEnds: false,
  closedLoft: true,
  smoothNormals: true,
  subdivisions: 1,
}

export interface SculptureData {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  boundingBox: THREE.Box3
  center: THREE.Vector3
}

class SculptureBuilder {
  private config: SculptureConfig
  private cachedGeometry: THREE.BufferGeometry | null = null
  private cachedMesh: THREE.Mesh | null = null

  constructor(config: Partial<SculptureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  build(
    crossSections: Map<string, THREE.Vector3[]>,
    intersections: CrossSectionIntersection[],
    material?: THREE.Material
  ): SculptureData {
    console.info('[SculptureBuilder] Building sculpture mesh...')

    const sortedSections = this.orderSectionsByIntersection(crossSections, intersections)
    
    if (sortedSections.length < 2) {
      console.warn('[SculptureBuilder] Need at least 2 cross-sections to build mesh')
      return this.createEmptySculpture(material)
    }

    let sectionsToLoft = sortedSections
    
    if (this.config.closedLoft) {
      sectionsToLoft = [...sortedSections, sortedSections[0]]
      console.info(`[SculptureBuilder] Closed loft: duplicated first section as last (${sectionsToLoft.length} total)`)
    }

    const normalizedSections = this.normalizeSectionVertexCounts(sectionsToLoft)
    const geometry = this.loftSections(normalizedSections, false)
    
    if (this.config.capEnds) {
      this.addEndCaps(geometry, normalizedSections)
    }

    if (this.config.smoothNormals) {
      geometry.computeVertexNormals()
    }

    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const boundingBox = geometry.boundingBox!.clone()
    const center = new THREE.Vector3()
    boundingBox.getCenter(center)

    const defaultMaterial = material || new THREE.MeshPhysicalMaterial({
      color: 0xcccccc,
      metalness: 0.9,
      roughness: 0.3,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geometry, defaultMaterial)
    mesh.name = 'SCULPTURE_MESH'

    this.cachedGeometry = geometry
    this.cachedMesh = mesh

    console.info(`[SculptureBuilder] Mesh built: ${geometry.attributes.position.count} vertices`)
    console.info(`[SculptureBuilder] Bounding box: (${boundingBox.min.x.toFixed(2)}, ${boundingBox.min.y.toFixed(2)}, ${boundingBox.min.z.toFixed(2)}) to (${boundingBox.max.x.toFixed(2)}, ${boundingBox.max.y.toFixed(2)}, ${boundingBox.max.z.toFixed(2)})`)

    return { mesh, geometry, boundingBox, center }
  }

  private orderSectionsByIntersection(
    crossSections: Map<string, THREE.Vector3[]>,
    intersections: CrossSectionIntersection[]
  ): THREE.Vector3[][] {
    const intersectionMap = new Map<string, CrossSectionIntersection>()
    for (const intersection of intersections) {
      intersectionMap.set(intersection.crossSectionName, intersection)
    }

    const sectionsWithParam: { name: string; vertices: THREE.Vector3[]; param: number }[] = []

    for (const [name, vertices] of crossSections) {
      const intersection = intersectionMap.get(name)
      const param = intersection?.pathParameter ?? 0
      sectionsWithParam.push({ name, vertices, param })
    }

    sectionsWithParam.sort((a, b) => a.param - b.param)

    console.info(`[SculptureBuilder] Ordered ${sectionsWithParam.length} cross-sections by path parameter`)

    return sectionsWithParam.map(s => s.vertices)
  }

  private loftSections(normalizedSections: THREE.Vector3[][], closedLoft: boolean): THREE.BufferGeometry {
    const verticesPerSection = normalizedSections[0].length
    const numSections = normalizedSections.length

    const positions: number[] = []
    const indices: number[] = []
    const uvs: number[] = []

    for (let s = 0; s < numSections; s++) {
      const section = normalizedSections[s]
      const v = s / (numSections - 1)

      for (let i = 0; i < section.length; i++) {
        const vertex = section[i]
        positions.push(vertex.x, vertex.y, vertex.z)

        const u = i / (section.length - 1)
        uvs.push(u, v)
      }
    }

    const sectionCount = closedLoft ? numSections : numSections - 1

    for (let s = 0; s < sectionCount; s++) {
      const nextS = (s + 1) % numSections

      for (let i = 0; i < verticesPerSection - 1; i++) {
        const current = s * verticesPerSection + i
        const next = current + 1
        const currentNext = nextS * verticesPerSection + i
        const nextNext = currentNext + 1

        indices.push(current, currentNext, next)
        indices.push(next, currentNext, nextNext)
      }

      const lastI = verticesPerSection - 1
      const current = s * verticesPerSection + lastI
      const first = s * verticesPerSection
      const currentNext = nextS * verticesPerSection + lastI
      const firstNext = nextS * verticesPerSection

      indices.push(current, currentNext, first)
      indices.push(first, currentNext, firstNext)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    console.info(`[SculptureBuilder] Loft: ${numSections} sections, ${verticesPerSection} verts/section, closed=${closedLoft}`)

    return geometry
  }

  private normalizeSectionVertexCounts(sections: THREE.Vector3[][]): THREE.Vector3[][] {
    const maxVertices = Math.max(...sections.map(s => s.length))
    const targetCount = Math.max(maxVertices, 32)

    return sections.map(section => {
      if (section.length === targetCount) return section

      const resampled: THREE.Vector3[] = []
      for (let i = 0; i < targetCount; i++) {
        const t = i / targetCount
        const srcIndex = t * section.length
        const i0 = Math.floor(srcIndex) % section.length
        const i1 = (i0 + 1) % section.length
        const frac = srcIndex - Math.floor(srcIndex)

        const v = new THREE.Vector3().lerpVectors(section[i0], section[i1], frac)
        resampled.push(v)
      }
      return resampled
    })
  }

  private addEndCaps(geometry: THREE.BufferGeometry, sections: THREE.Vector3[][]): void {
    const positions = geometry.attributes.position.array as Float32Array
    const indices = geometry.index!.array as Uint32Array
    
    const newPositions = Array.from(positions)
    const newIndices = Array.from(indices)

    const firstSection = sections[0]
    const lastSection = sections[sections.length - 1]

    const firstCenter = this.computeCentroid(firstSection)
    const lastCenter = this.computeCentroid(lastSection)

    const baseVertexCount = positions.length / 3

    newPositions.push(firstCenter.x, firstCenter.y, firstCenter.z)
    const firstCenterIdx = baseVertexCount

    newPositions.push(lastCenter.x, lastCenter.y, lastCenter.z)
    const lastCenterIdx = baseVertexCount + 1

    const verticesPerSection = sections[0].length
    for (let i = 0; i < verticesPerSection; i++) {
      const next = (i + 1) % verticesPerSection
      newIndices.push(firstCenterIdx, next, i)
    }

    const lastSectionOffset = (sections.length - 1) * verticesPerSection
    for (let i = 0; i < verticesPerSection; i++) {
      const next = (i + 1) % verticesPerSection
      newIndices.push(lastCenterIdx, lastSectionOffset + i, lastSectionOffset + next)
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3))
    geometry.setIndex(newIndices)
  }

  private computeCentroid(vertices: THREE.Vector3[]): THREE.Vector3 {
    const centroid = new THREE.Vector3()
    for (const v of vertices) {
      centroid.add(v)
    }
    return centroid.divideScalar(vertices.length)
  }

  private createEmptySculpture(material?: THREE.Material): SculptureData {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const mat = material || new THREE.MeshPhysicalMaterial({ color: 0xff0000 })
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.name = 'SCULPTURE_MESH_PLACEHOLDER'

    return {
      mesh,
      geometry,
      boundingBox: new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)),
      center: new THREE.Vector3(0, 0, 0),
    }
  }

  getCachedMesh(): THREE.Mesh | null {
    return this.cachedMesh
  }

  getCachedGeometry(): THREE.BufferGeometry | null {
    return this.cachedGeometry
  }

  updateConfig(config: Partial<SculptureConfig>): void {
    this.config = { ...this.config, ...config }
  }

  dispose(): void {
    if (this.cachedGeometry) {
      this.cachedGeometry.dispose()
      this.cachedGeometry = null
    }
    this.cachedMesh = null
  }
}

export const sculptureBuilder = new SculptureBuilder()
export default sculptureBuilder
