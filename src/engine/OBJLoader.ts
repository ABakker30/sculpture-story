import * as THREE from 'three'

export interface ParsedOBJData {
  objects: Map<string, THREE.Object3D>
  sculpturePath: THREE.Vector3[] | null
  sculptureCurve: THREE.Vector3[] | null
  crossSections: Map<string, THREE.Vector3[]>
}

export interface OBJValidationResult {
  valid: boolean
  hasSculpturePath: boolean
  hasSculptureCurve: boolean
  crossSectionCount: number
  missingRequired: string[]
  warnings: string[]
}

interface ParsedObject {
  name: string
  vertices: THREE.Vector3[]
  curveIndices: number[]
}

class OBJLoaderService {
  private lastParsedData: ParsedOBJData | null = null

  async load(url: string): Promise<ParsedOBJData> {
    console.info(`[OBJLoader] Loading OBJ from: ${url}`)
    
    const response = await fetch(url)
    const text = await response.text()
    const data = this.parseOBJText(text)
    
    this.lastParsedData = data
    this.logValidation(this.validate(data))
    
    return data
  }

  private parseOBJText(text: string): ParsedOBJData {
    const lines = text.split('\n')
    const globalVertices: THREE.Vector3[] = []
    const parsedObjects: ParsedObject[] = []
    
    let currentObject: ParsedObject | null = null

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const parts = trimmed.split(/\s+/)
      const cmd = parts[0]

      if (cmd === 'v') {
        const x = parseFloat(parts[1]) || 0
        const y = parseFloat(parts[2]) || 0
        const z = parseFloat(parts[3]) || 0
        globalVertices.push(new THREE.Vector3(x, y, z))
      }
      else if (cmd === 'o') {
        if (currentObject && currentObject.name) {
          parsedObjects.push(currentObject)
        }
        currentObject = {
          name: parts.slice(1).join(' '),
          vertices: [],
          curveIndices: []
        }
      }
      else if (cmd === 'curv' && currentObject) {
        const indices = parts.slice(3).map(s => parseInt(s, 10) - 1)
        currentObject.curveIndices = indices
      }
    }

    if (currentObject && currentObject.name) {
      parsedObjects.push(currentObject)
    }

    for (const obj of parsedObjects) {
      if (obj.curveIndices.length > 0) {
        obj.vertices = obj.curveIndices
          .filter(i => i >= 0 && i < globalVertices.length)
          .map(i => globalVertices[i].clone())
      }
    }

    const objects = new Map<string, THREE.Object3D>()
    const crossSections = new Map<string, THREE.Vector3[]>()
    let sculpturePath: THREE.Vector3[] | null = null
    let sculptureCurve: THREE.Vector3[] | null = null

    for (const obj of parsedObjects) {
      const group = new THREE.Group()
      group.name = obj.name
      objects.set(obj.name, group)

      if (obj.name === 'SCULPTURE_PATH') {
        sculpturePath = obj.vertices
        console.info(`[OBJLoader] Found SCULPTURE_PATH with ${sculpturePath.length} vertices`)
      }
      else if (obj.name === 'SCULPTURE_CURVE') {
        sculptureCurve = obj.vertices
        console.info(`[OBJLoader] Found SCULPTURE_CURVE with ${sculptureCurve.length} vertices`)
      }
      else if (obj.name.startsWith('CROSS_SECTION_')) {
        crossSections.set(obj.name, obj.vertices)
      }
    }

    console.info(`[OBJLoader] Parsed ${objects.size} objects, ${crossSections.size} cross-sections`)
    console.info(`[OBJLoader] Total vertices in file: ${globalVertices.length}`)
    
    return { objects, sculpturePath, sculptureCurve, crossSections }
  }

  validate(data: ParsedOBJData): OBJValidationResult {
    const missingRequired: string[] = []
    const warnings: string[] = []

    const hasSculpturePath = data.sculpturePath !== null && data.sculpturePath.length > 0
    const hasSculptureCurve = data.sculptureCurve !== null && data.sculptureCurve.length > 0
    const crossSectionCount = data.crossSections.size

    if (!hasSculpturePath) {
      missingRequired.push('SCULPTURE_PATH')
    }

    if (crossSectionCount === 0) {
      missingRequired.push('CROSS_SECTION_0001+')
    }

    if (!hasSculptureCurve) {
      warnings.push('SCULPTURE_CURVE not found (optional)')
    }

    return {
      valid: missingRequired.length === 0,
      hasSculpturePath,
      hasSculptureCurve,
      crossSectionCount,
      missingRequired,
      warnings
    }
  }

  private logValidation(result: OBJValidationResult): void {
    console.info('[OBJLoader] === Validation Results ===')
    console.info(`[OBJLoader] SCULPTURE_PATH: ${result.hasSculpturePath ? '✓' : '✗'}`)
    console.info(`[OBJLoader] SCULPTURE_CURVE: ${result.hasSculptureCurve ? '✓' : '(optional, not found)'}`)
    console.info(`[OBJLoader] Cross-sections found: ${result.crossSectionCount}`)
    
    if (result.missingRequired.length > 0) {
      console.warn('[OBJLoader] Missing required:', result.missingRequired)
    }
    
    if (result.warnings.length > 0) {
      console.warn('[OBJLoader] Warnings:', result.warnings)
    }
    
    console.info(`[OBJLoader] Overall: ${result.valid ? 'VALID ✓' : 'INVALID ✗'}`)
  }

  getLastParsedData(): ParsedOBJData | null {
    return this.lastParsedData
  }

  getObject(name: string): THREE.Object3D | undefined {
    return this.lastParsedData?.objects.get(name)
  }

  getAllByPrefix(prefix: string): THREE.Object3D[] {
    if (!this.lastParsedData) return []
    
    const results: THREE.Object3D[] = []
    const sortedKeys = Array.from(this.lastParsedData.objects.keys())
      .filter(key => key.startsWith(prefix))
      .sort()
    
    for (const key of sortedKeys) {
      const obj = this.lastParsedData.objects.get(key)
      if (obj) results.push(obj)
    }
    
    return results
  }

  getCrossSectionNames(): string[] {
    if (!this.lastParsedData) return []
    return Array.from(this.lastParsedData.crossSections.keys()).sort()
  }
}

export const objLoader = new OBJLoaderService()
export default objLoader
