import * as THREE from 'three'
import qh from 'quickhull3d'

export interface CameraViewpoint {
  position: THREE.Vector3
  target: THREE.Vector3
  label: string
  type: 'corner' | 'edge' | 'face'
}

/**
 * Compute convex hull from path corners and generate camera viewpoints
 */
export function computeHullCameraPositions(pathCorners: THREE.Vector3[]): CameraViewpoint[] {
  if (pathCorners.length < 4) {
    console.warn('[ConvexHull] Need at least 4 points for 3D hull')
    return []
  }

  // Convert to array format for quickhull3d
  const points: [number, number, number][] = pathCorners.map(p => [p.x, p.y, p.z])
  
  // Compute convex hull - returns array of face indices
  const faces = qh(points)
  
  // Compute hull centroid
  const centroid = new THREE.Vector3()
  pathCorners.forEach(p => centroid.add(p))
  centroid.divideScalar(pathCorners.length)
  
  // Compute bounding sphere for camera distance
  let maxDist = 0
  pathCorners.forEach(p => {
    const dist = p.distanceTo(centroid)
    if (dist > maxDist) maxDist = dist
  })
  const cameraDistance = maxDist * 2.5
  
  const viewpoints: CameraViewpoint[] = []
  const usedEdges = new Set<string>()
  
  // 1. Corner viewpoints - camera at each hull vertex looking at centroid
  const hullVertexIndices = new Set<number>()
  faces.forEach(face => {
    face.forEach(idx => hullVertexIndices.add(idx))
  })
  
  hullVertexIndices.forEach(idx => {
    const corner = pathCorners[idx]
    const direction = new THREE.Vector3().subVectors(corner, centroid).normalize()
    const position = centroid.clone().add(direction.multiplyScalar(cameraDistance))
    
    viewpoints.push({
      position,
      target: centroid.clone(),
      label: `Corner ${viewpoints.length + 1}`,
      type: 'corner'
    })
  })
  
  // 2. Edge center viewpoints - camera at edge midpoint direction looking at centroid
  faces.forEach(face => {
    for (let i = 0; i < face.length; i++) {
      const idx1 = face[i]
      const idx2 = face[(i + 1) % face.length]
      
      // Create unique edge key (smaller index first)
      const edgeKey = idx1 < idx2 ? `${idx1}-${idx2}` : `${idx2}-${idx1}`
      
      if (!usedEdges.has(edgeKey)) {
        usedEdges.add(edgeKey)
        
        const p1 = pathCorners[idx1]
        const p2 = pathCorners[idx2]
        const edgeCenter = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5)
        
        const direction = new THREE.Vector3().subVectors(edgeCenter, centroid).normalize()
        const position = centroid.clone().add(direction.multiplyScalar(cameraDistance))
        
        viewpoints.push({
          position,
          target: centroid.clone(),
          label: `Edge ${viewpoints.length + 1 - hullVertexIndices.size}`,
          type: 'edge'
        })
      }
    }
  })
  
  // 3. Face perpendicular viewpoints - camera perpendicular to each face
  const faceStartIdx = viewpoints.length
  faces.forEach((face, faceIdx) => {
    if (face.length < 3) return
    
    // Compute face center
    const faceCenter = new THREE.Vector3()
    face.forEach(idx => faceCenter.add(pathCorners[idx]))
    faceCenter.divideScalar(face.length)
    
    // Compute face normal using first 3 vertices
    const v0 = pathCorners[face[0]]
    const v1 = pathCorners[face[1]]
    const v2 = pathCorners[face[2]]
    
    const edge1 = new THREE.Vector3().subVectors(v1, v0)
    const edge2 = new THREE.Vector3().subVectors(v2, v0)
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize()
    
    // Ensure normal points outward (away from centroid)
    const toCentroid = new THREE.Vector3().subVectors(centroid, faceCenter)
    if (normal.dot(toCentroid) > 0) {
      normal.negate()
    }
    
    // Camera position along face normal
    const position = faceCenter.clone().add(normal.clone().multiplyScalar(cameraDistance))
    
    viewpoints.push({
      position,
      target: faceCenter.clone(),
      label: `Face ${faceIdx + 1}`,
      type: 'face'
    })
  })
  
  console.info(`[ConvexHull] Generated ${viewpoints.length} viewpoints: ${hullVertexIndices.size} corners, ${usedEdges.size} edges, ${viewpoints.length - faceStartIdx} faces`)
  
  return viewpoints
}

/**
 * Create a wireframe geometry for the convex hull visualization
 */
export function createHullGeometry(pathCorners: THREE.Vector3[]): THREE.BufferGeometry | null {
  if (pathCorners.length < 4) return null
  
  const points: [number, number, number][] = pathCorners.map(p => [p.x, p.y, p.z])
  const faces = qh(points)
  
  // Create line segments for hull edges
  const vertices: number[] = []
  const usedEdges = new Set<string>()
  
  faces.forEach(face => {
    for (let i = 0; i < face.length; i++) {
      const idx1 = face[i]
      const idx2 = face[(i + 1) % face.length]
      const edgeKey = idx1 < idx2 ? `${idx1}-${idx2}` : `${idx2}-${idx1}`
      
      if (!usedEdges.has(edgeKey)) {
        usedEdges.add(edgeKey)
        const p1 = pathCorners[idx1]
        const p2 = pathCorners[idx2]
        vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z)
      }
    }
  })
  
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  return geometry
}

export default { computeHullCameraPositions, createHullGeometry }
