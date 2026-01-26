import { useState } from 'react'

interface DesignPointsModalProps {
  isOpen: boolean
  onClose: () => void
  onGalaxyStarsChange: (value: number) => void
  galaxyStarsValue: number
}

export function DesignPointsModal({ 
  isOpen, 
  onClose, 
  onGalaxyStarsChange,
  galaxyStarsValue 
}: DesignPointsModalProps) {
  const [showInfo, setShowInfo] = useState(false)

  if (!isOpen) return null

  const styles = {
    overlay: {
      position: 'fixed' as const,
      bottom: '80px',
      left: '20px',
      right: '20px',
      background: 'rgba(20,20,20,0.9)',
      padding: '16px',
      zIndex: 900,
      backdropFilter: 'blur(10px)',
      borderRadius: '12px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px',
    },
    title: {
      color: '#fff',
      fontSize: '14px',
      fontFamily: 'sans-serif',
    },
    closeButton: {
      background: 'transparent',
      border: 'none',
      color: '#666',
      fontSize: '18px',
      cursor: 'pointer',
      padding: '0',
      lineHeight: 1,
    },
    sliderRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    },
    slider: {
      flex: 1,
      height: '4px',
      WebkitAppearance: 'none' as const,
      appearance: 'none' as const,
      background: '#333',
      borderRadius: '2px',
      outline: 'none',
      cursor: 'pointer',
    },
    infoButton: {
      background: 'transparent',
      border: '1px solid #444',
      borderRadius: '50%',
      width: '20px',
      height: '20px',
      color: '#666',
      fontSize: '12px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    infoPanel: {
      background: 'rgba(40,40,40,0.9)',
      borderRadius: '8px',
      padding: '12px',
      marginTop: '12px',
    },
    infoText: {
      color: '#aaa',
      fontSize: '12px',
      fontFamily: 'sans-serif',
      lineHeight: '1.4',
      margin: 0,
    },
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.header}>
        <span style={styles.title}>Galaxy Stars</span>
        <button style={styles.closeButton} onClick={onClose}>×</button>
      </div>
      <div style={styles.sliderRow}>
        <input
          type="range"
          min="0"
          max="100"
          value={galaxyStarsValue}
          onChange={(e) => {
            const val = Number(e.target.value)
            console.log('[GalaxyStars] Slider value:', val)
            onGalaxyStarsChange(val)
          }}
          style={styles.slider}
        />
        <button 
          style={styles.infoButton} 
          onClick={() => setShowInfo(!showInfo)}
          title="Learn more"
        >
          i
        </button>
      </div>
      {showInfo && (
        <div style={styles.infoPanel}>
          <p style={styles.infoText}>
            Adds a field of stars around the sculpture in a galaxy-like pattern.
          </p>
        </div>
      )}
    </div>
  )
}
