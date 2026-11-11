/// <reference types="vite/client" />
// The prebuilt browser bundle of tesseract.js, narrowed to what the label reader uses.
declare module 'tesseract.js/dist/tesseract.esm.min.js' {
  interface Worker {
    setParameters: (params: Record<string, string>) => Promise<unknown>
    recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>
    terminate: () => Promise<unknown>
  }
  const tesseract: {
    OEM: { LSTM_ONLY: number }
    PSM: { SINGLE_BLOCK: string }
    createWorker: (lang: string, oem: number, options: Record<string, unknown>) => Promise<Worker>
  }
  // The prebuilt bundle is a UMD file, which the bundler exposes as the default export.
  export default tesseract
}
