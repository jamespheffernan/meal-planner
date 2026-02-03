export interface ImageProcessOptions {
  maxSize?: number
  outputType?: 'image/jpeg' | 'image/png'
  quality?: number
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (err) => {
      URL.revokeObjectURL(url)
      reject(err)
    }
    img.src = url
  })
}

export async function imageFileToBase64(
  file: File,
  options: ImageProcessOptions = {}
): Promise<{ base64: string; mimeType: string }> {
  const maxSize = options.maxSize ?? 2000
  const quality = options.quality ?? 0.9
  let outputType: 'image/jpeg' | 'image/png' = options.outputType ?? 'image/jpeg'

  let blob: Blob = file
  let mimeType = file.type || 'image/jpeg'
  const lowerType = mimeType.toLowerCase()

  if (lowerType.includes('heic') || lowerType.includes('heif')) {
    const heic2any = (await import('heic2any')).default as (args: {
      blob: Blob
      toType: string
      quality?: number
    }) => Promise<Blob>
    blob = await heic2any({ blob, toType: 'image/jpeg', quality })
    mimeType = 'image/jpeg'
    outputType = 'image/jpeg'
  }

  const image = await loadImageFromBlob(blob)
  const scale = Math.min(1, maxSize / image.width, maxSize / image.height)
  const targetWidth = Math.max(1, Math.round(image.width * scale))
  const targetHeight = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    const base64 = await blobToBase64(blob)
    return { base64, mimeType }
  }

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

  const processedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error('Failed to process image'))
        return
      }
      resolve(result)
    }, outputType, quality)
  })

  const base64 = await blobToBase64(processedBlob)
  return { base64, mimeType: outputType }
}
