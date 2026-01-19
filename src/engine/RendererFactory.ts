import * as THREE from 'three'

export type RendererType = 'webgpu' | 'webgl'

interface RendererResult {
  renderer: THREE.WebGLRenderer
  type: RendererType
}

/**
 * Check if WebGPU is supported in the current browser
 */
export async function isWebGPUSupported(): Promise<boolean> {
  if (!navigator.gpu) {
    return false
  }
  
  try {
    const adapter = await navigator.gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}

/**
 * Create a renderer with WebGPU preference and WebGL fallback
 * Note: Currently returns WebGL renderer as R3F 8.x doesn't fully support WebGPU
 * When R3F 9+ is available, this can be updated to return WebGPURenderer
 */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererResult> {
  const webgpuSupported = await isWebGPUSupported()
  
  if (webgpuSupported) {
    console.info('[Renderer] WebGPU is supported by browser')
    // Note: Full WebGPU integration requires R3F 9+ or direct Three.js usage
    // For now, we log support status but use WebGL for R3F compatibility
  } else {
    console.info('[Renderer] WebGPU not supported, using WebGL')
  }
  
  // Create WebGL renderer (R3F 8.x compatible)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })
  
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  
  return {
    renderer,
    type: 'webgl'
  }
}

/**
 * Get renderer info for display
 */
export function getRendererInfo(gl: THREE.WebGLRenderer): {
  vendor: string
  renderer: string
  webglVersion: string
} {
  const debugInfo = gl.getContext().getExtension('WEBGL_debug_renderer_info')
  
  if (debugInfo) {
    const glContext = gl.getContext()
    return {
      vendor: glContext.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'Unknown',
      renderer: glContext.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Unknown',
      webglVersion: gl.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1'
    }
  }
  
  return {
    vendor: 'Unknown',
    renderer: 'Unknown',
    webglVersion: gl.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1'
  }
}

export default { isWebGPUSupported, createRenderer, getRendererInfo }
