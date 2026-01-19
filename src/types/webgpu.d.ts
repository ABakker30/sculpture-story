// WebGPU type declarations
interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>
}

interface GPUAdapter {
  requestDevice(): Promise<GPUDevice>
}

interface GPUDevice {
  // Basic device interface
}

interface Navigator {
  gpu?: GPU
}
