import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

import assetRegistry from './engine/AssetRegistry'
import placeholderManager from './engine/PlaceholderAssets'
import timelineController from './engine/TimelineController'
import chapterManager, { ChapterContext } from './engine/ChapterManager'
import { geometryDeriver } from './engine/GeometryDerivation'
import allChapters from './chapters'
import TimelineUI from './ui/TimelineUI'

function SceneContent() {
  const { scene, camera, gl } = useThree()
  const controlsRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const sculptureGroup = useRef<THREE.Group | null>(null)

  useEffect(() => {
    async function initScene() {
      const loaded = await assetRegistry.load('/assets/models/sculpture.glb')
      
      let group: THREE.Group
      if (!loaded || assetRegistry.usePlaceholder) {
        group = placeholderManager.generate()
      } else {
        group = new THREE.Group()
        const pathObj = assetRegistry.get('SCULPTURE_PATH')
        const curveObj = assetRegistry.get('SCULPTURE_CURVE')
        if (pathObj) {
          group.add(pathObj.clone())
          geometryDeriver.derive(pathObj, curveObj || null)
        }
      }
      
      scene.add(group)
      sculptureGroup.current = group

      const ctx: ChapterContext = {
        scene,
        camera,
        renderer: gl,
        getAsset: (name) => assetRegistry.get(name),
        getAllAssets: (prefix) => assetRegistry.getAll(prefix),
      }

      chapterManager.registerAll(allChapters)
      chapterManager.setContext(ctx)
      chapterManager.initialize()
      
      setReady(true)
    }

    initScene()

    return () => {
      if (sculptureGroup.current) {
        scene.remove(sculptureGroup.current)
      }
      placeholderManager.dispose()
      geometryDeriver.dispose()
      chapterManager.dispose()
    }
  }, [scene, camera, gl])

  useFrame(() => {
    if (ready) {
      const state = timelineController.getState()
      chapterManager.update(state.t)
    }
  })

  const handleControlsStart = () => {
    timelineController.onUserInteraction()
  }

  const handleControlsEnd = () => {
    timelineController.onUserInteractionEnd()
  }

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <OrbitControls
        ref={controlsRef}
        onStart={handleControlsStart}
        onEnd={handleControlsEnd}
      />
    </>
  )
}

function App() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [8, 6, 8], fov: 50 }}
        style={{ background: '#000' }}
        gl={{ antialias: true }}
        onCreated={({ scene }: { scene: THREE.Scene }) => {
          scene.background = new THREE.Color(0x0a0a0a)
        }}
      >
        <SceneContent />
      </Canvas>
      <TimelineUI />
    </div>
  )
}

export default App
