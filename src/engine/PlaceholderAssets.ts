import * as THREE from 'three'

export interface PlaceholderData {
  sculpturePath: THREE.Vector3[]
  sculptureCurve: THREE.Vector3[] | null
  crossSections: THREE.Vector3[][]
}

export function generatePlaceholderData(): PlaceholderData {
  const sculpturePath = generateHelixPath(10, 2, 5)
  const sculptureCurve = generateSmoothCurve(sculpturePath, 50)
  const crossSections = generateCircleCrossSections(10, 0.3)

  return {
    sculpturePath,
    sculptureCurve,
    crossSections
  }
}

function generateHelixPath(segments: number, radius: number, height: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const angle = t * Math.PI * 2 * 1.5
    points.push(new THREE.Vector3(
      Math.cos(angle) * radius,
      t * height - height / 2,
      Math.sin(angle) * radius
    ))
  }
  return points
}

function generateSmoothCurve(path: THREE.Vector3[], samples: number): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(path)
  return curve.getPoints(samples)
}

function generateCircleCrossSections(count: number, radius: number): THREE.Vector3[][] {
  const sections: THREE.Vector3[][] = []
  const pointsPerSection = 16

  for (let i = 0; i < count; i++) {
    const section: THREE.Vector3[] = []
    for (let j = 0; j <= pointsPerSection; j++) {
      const angle = (j / pointsPerSection) * Math.PI * 2
      section.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius
      ))
    }
    sections.push(section)
  }

  return sections
}

export function createPlaceholderGeometry(data: PlaceholderData): THREE.Group {
  const group = new THREE.Group()
  group.name = 'PLACEHOLDER_ROOT'

  // SCULPTURE_PATH as line
  const pathGeometry = new THREE.BufferGeometry().setFromPoints(data.sculpturePath)
  const pathMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 })
  const pathLine = new THREE.Line(pathGeometry, pathMaterial)
  pathLine.name = 'SCULPTURE_PATH'
  group.add(pathLine)

  // SCULPTURE_CURVE as smooth line
  if (data.sculptureCurve) {
    const curveGeometry = new THREE.BufferGeometry().setFromPoints(data.sculptureCurve)
    const curveMaterial = new THREE.LineBasicMaterial({ color: 0x0088ff, opacity: 0.5, transparent: true })
    const curveLine = new THREE.Line(curveGeometry, curveMaterial)
    curveLine.name = 'SCULPTURE_CURVE'
    group.add(curveLine)
  }

  // Cross-sections positioned along path
  data.crossSections.forEach((section, index) => {
    const t = index / (data.crossSections.length - 1)
    const pathIndex = Math.floor(t * (data.sculpturePath.length - 1))
    const position = data.sculpturePath[pathIndex]

    const sectionGeometry = new THREE.BufferGeometry().setFromPoints(section)
    const sectionMaterial = new THREE.LineBasicMaterial({ color: 0xff8800 })
    const sectionLine = new THREE.LineLoop(sectionGeometry, sectionMaterial)
    sectionLine.name = `CROSS_SECTION_${String(index + 1).padStart(4, '0')}`
    sectionLine.position.copy(position)

    // Orient cross-section perpendicular to path
    if (pathIndex < data.sculpturePath.length - 1) {
      const nextPoint = data.sculpturePath[pathIndex + 1]
      const direction = new THREE.Vector3().subVectors(nextPoint, position).normalize()
      const up = new THREE.Vector3(0, 1, 0)
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction)
      sectionLine.quaternion.copy(quaternion)
    }

    group.add(sectionLine)
  })

  return group
}

export class PlaceholderManager {
  private data: PlaceholderData | null = null
  private geometry: THREE.Group | null = null

  generate(): THREE.Group {
    this.data = generatePlaceholderData()
    this.geometry = createPlaceholderGeometry(this.data)
    console.info('[PlaceholderManager] Generated placeholder geometry')
    return this.geometry
  }

  getData(): PlaceholderData | null {
    return this.data
  }

  getGeometry(): THREE.Group | null {
    return this.geometry
  }

  dispose(): void {
    if (this.geometry) {
      this.geometry.traverse((obj) => {
        if (obj instanceof THREE.Line) {
          obj.geometry.dispose()
          if (obj.material instanceof THREE.Material) {
            obj.material.dispose()
          }
        }
      })
      this.geometry = null
    }
    this.data = null
  }
}

export const placeholderManager = new PlaceholderManager()
export default placeholderManager
