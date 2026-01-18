import { useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { OBJTestVerification, OBJVerificationOverlay } from './engine/OBJTestVerification'
import objLoader, { OBJValidationResult } from './engine/OBJLoader'

function TestSceneContent({ onValidation }: { onValidation: (v: OBJValidationResult) => void }) {
  useEffect(() => {
    const checkValidation = setInterval(() => {
      const data = objLoader.getLastParsedData()
      if (data) {
        const validation = objLoader.validate(data)
        onValidation(validation)
        clearInterval(checkValidation)
      }
    }, 100)
    
    return () => clearInterval(checkValidation)
  }, [onValidation])

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <gridHelper args={[30, 30, 0x444444, 0x222222]} />
      <axesHelper args={[5]} />
      <OBJTestVerification />
      <OrbitControls />
    </>
  )
}

export function AppTest() {
  const [validation, setValidation] = useState<OBJValidationResult | null>(null)

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [15, 15, 15], fov: 50 }}
        style={{ background: '#000' }}
        gl={{ antialias: true }}
        onCreated={({ scene }: { scene: THREE.Scene }) => {
          scene.background = new THREE.Color(0x0a0a0a)
        }}
      >
        <TestSceneContent onValidation={setValidation} />
      </Canvas>
      <OBJVerificationOverlay validation={validation} />
      <div style={infoStyles}>
        <h2>OBJ Import Test</h2>
        <p>Loading: <code>/grasshopper-data/sculpture.obj</code></p>
        <p>Check console for detailed logs</p>
        <div style={{ marginTop: '12px', fontSize: '12px', color: '#888' }}>
          <strong>Color Legend:</strong><br />
          🟢 Green = SCULPTURE_PATH<br />
          🔵 Blue = SCULPTURE_CURVE<br />
          🟠 Orange = Cross-sections
        </div>
      </div>
    </div>
  )
}

const infoStyles: React.CSSProperties = {
  position: 'absolute',
  bottom: '20px',
  right: '20px',
  background: 'rgba(0,0,0,0.8)',
  padding: '16px',
  borderRadius: '8px',
  fontFamily: 'sans-serif',
  fontSize: '14px',
  color: '#fff',
  maxWidth: '280px',
}

export default AppTest
