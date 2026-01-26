import { useState, useEffect } from 'react'
import materialController from '../engine/MaterialController'

interface UVDebugModalProps {
  isOpen: boolean
  onClose: () => void
}

export function UVDebugModal({ isOpen, onClose }: UVDebugModalProps) {
  const [repeatU, setRepeatU] = useState(1)
  const [repeatV, setRepeatV] = useState(5)
  const [gridSize, setGridSize] = useState(4)

  useEffect(() => {
    if (isOpen) {
      const stored = materialController.getUVRepeat()
      setRepeatU(stored.u)
      setRepeatV(stored.v)
      materialController.applyUVChecker(gridSize, stored.u, stored.v)
    }
  }, [isOpen])

  const handleApply = () => {
    materialController.setUVRepeat(repeatU, repeatV)
    materialController.applyUVChecker(gridSize, repeatU, repeatV)
  }

  if (!isOpen) return null

  const styles = {
    overlay: {
      position: 'fixed' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    },
    modal: {
      background: 'rgba(30,30,30,0.95)',
      borderRadius: '12px',
      padding: '24px',
      minWidth: '300px',
      color: 'white',
      backdropFilter: 'blur(10px)',
    },
    title: {
      fontSize: '18px',
      fontWeight: 'bold' as const,
      marginBottom: '20px',
    },
    row: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '16px',
    },
    label: {
      fontSize: '14px',
    },
    input: {
      width: '80px',
      padding: '6px 10px',
      borderRadius: '6px',
      border: '1px solid #555',
      background: '#222',
      color: 'white',
      fontSize: '14px',
    },
    slider: {
      width: '120px',
      marginLeft: '12px',
    },
    buttonRow: {
      display: 'flex',
      gap: '12px',
      marginTop: '20px',
    },
    button: {
      flex: 1,
      padding: '10px 16px',
      borderRadius: '8px',
      border: 'none',
      cursor: 'pointer',
      fontSize: '14px',
    },
    applyButton: {
      background: '#4488ff',
      color: 'white',
    },
    closeButton: {
      background: '#555',
      color: 'white',
    },
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.title}>UV Debug Settings</div>
        
        <div style={styles.row}>
          <span style={styles.label}>Repeat U:</span>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="number"
              value={repeatU}
              onChange={e => setRepeatU(Number(e.target.value))}
              style={styles.input}
              min={1}
              max={100}
            />
            <input
              type="range"
              value={repeatU}
              onChange={e => setRepeatU(Number(e.target.value))}
              style={styles.slider}
              min={1}
              max={100}
            />
          </div>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Repeat V:</span>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="number"
              value={repeatV}
              onChange={e => setRepeatV(Number(e.target.value))}
              style={styles.input}
              min={1}
              max={100}
            />
            <input
              type="range"
              value={repeatV}
              onChange={e => setRepeatV(Number(e.target.value))}
              style={styles.slider}
              min={1}
              max={100}
            />
          </div>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Grid Size:</span>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="number"
              value={gridSize}
              onChange={e => setGridSize(Number(e.target.value))}
              style={styles.input}
              min={2}
              max={32}
            />
            <input
              type="range"
              value={gridSize}
              onChange={e => setGridSize(Number(e.target.value))}
              style={styles.slider}
              min={2}
              max={32}
            />
          </div>
        </div>

        <div style={styles.buttonRow}>
          <button 
            style={{ ...styles.button, ...styles.applyButton }} 
            onClick={handleApply}
          >
            Apply
          </button>
          <button 
            style={{ ...styles.button, ...styles.closeButton }} 
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
