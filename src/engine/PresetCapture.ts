import lightingController, { LightingConfig } from './LightingController'
import materialController, { MaterialConfig } from './MaterialController'

export interface ScenePreset {
  name: string
  timestamp: string
  lighting: LightingConfig
  material: MaterialConfig
}

class PresetCapture {
  capturePreset(name: string = 'Untitled'): ScenePreset {
    const preset: ScenePreset = {
      name,
      timestamp: new Date().toISOString(),
      lighting: lightingController.getConfig(),
      material: materialController.getConfig(),
    }

    console.info('[PresetCapture] Captured preset:')
    console.info(JSON.stringify(preset, null, 2))

    return preset
  }

  copyPresetToClipboard(name: string = 'Untitled'): void {
    const preset = this.capturePreset(name)
    const json = JSON.stringify(preset, null, 2)

    if (navigator.clipboard) {
      navigator.clipboard.writeText(json).then(() => {
        console.info('[PresetCapture] Preset copied to clipboard!')
      }).catch((err) => {
        console.error('[PresetCapture] Failed to copy to clipboard:', err)
        console.info('[PresetCapture] Preset JSON:')
        console.info(json)
      })
    } else {
      console.info('[PresetCapture] Clipboard not available. Preset JSON:')
      console.info(json)
    }
  }

  applyPreset(preset: ScenePreset): void {
    const { lighting, material } = preset

    lightingController.setEnvironmentIntensity(lighting.environmentIntensity)
    lightingController.setShowBackground(lighting.showBackground)
    lightingController.setKeyLightIntensity(lighting.keyLightIntensity)
    lightingController.setKeyLightDirection(lighting.keyLightAzimuth, lighting.keyLightElevation)
    lightingController.setFillLightIntensity(lighting.fillLightIntensity)
    lightingController.setRimLightEnabled(lighting.rimLightEnabled)
    lightingController.setRimLightIntensity(lighting.rimLightIntensity)

    materialController.setColor(material.color)
    materialController.setMetalness(material.metalness)
    materialController.setRoughness(material.roughness)
    materialController.setClearcoat(material.clearcoat)
    materialController.setClearcoatRoughness(material.clearcoatRoughness)
    materialController.setTransmission(material.transmission)
    materialController.setOpacity(material.opacity)
    materialController.setIOR(material.ior)
    materialController.setThickness(material.thickness)

    console.info(`[PresetCapture] Applied preset: ${preset.name}`)
  }
}

export const presetCapture = new PresetCapture()
export default presetCapture
