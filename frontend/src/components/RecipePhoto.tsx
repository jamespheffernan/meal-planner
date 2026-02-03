'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { recipes } from '@/lib/api'
import { imageFileToBase64 } from '@/lib/image'
import { Camera, Search, Loader2, Crop, X, Check, MoreVertical, Sparkles, Upload } from 'lucide-react'
import clsx from 'clsx'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'

interface RecipePhotoProps {
  recipeId: string
  photoUrl?: string | null
  recipeName: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  editable?: boolean
}

export default function RecipePhoto({ recipeId, photoUrl, recipeName, size = 'md', editable = true }: RecipePhotoProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isHovering, setIsHovering] = useState(false)
  const [showCropper, setShowCropper] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const { base64, mimeType } = await imageFileToBase64(file, { maxSize: 1600, quality: 0.85 })
      return recipes.updatePhoto(recipeId, { photoBase64: base64, mimeType })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] })
    },
  })

  const saveCroppedMutation = useMutation({
    mutationFn: async (base64: string) => {
      return recipes.updatePhoto(recipeId, { photoBase64: base64, mimeType: 'image/jpeg' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] })
      setShowCropper(false)
    },
  })

  const findImageMutation = useMutation({
    mutationFn: () => recipes.findImage(recipeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] })
    },
  })

  const generateImageMutation = useMutation({
    mutationFn: () => recipes.generateImage(recipeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] })
    },
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      uploadMutation.mutate(file)
    }
  }

  const handleClick = () => {
    if (editable) {
      fileInputRef.current?.click()
    }
  }

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  useEffect(() => {
    if (!showOptions) return
    const handleClick = (event: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(event.target as Node)) {
        setShowOptions(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [showOptions])

  const handleSaveCrop = async () => {
    if (!photoUrl || !croppedAreaPixels) return

    const croppedBase64 = await getCroppedImg(photoUrl, croppedAreaPixels)
    if (croppedBase64) {
      saveCroppedMutation.mutate(croppedBase64)
    }
  }

  const isLoading = uploadMutation.isPending
    || findImageMutation.isPending
    || saveCroppedMutation.isPending
    || generateImageMutation.isPending

  const sizeClasses = {
    xs: 'h-12 w-12',
    sm: 'h-32 w-32',
    md: 'h-48 w-full',
    lg: 'h-64 w-full',
  }

  return (
    <div className="relative">
      <div
        className={clsx(
          'relative overflow-hidden rounded-lg cursor-pointer transition-all',
          sizeClasses[size],
          editable && 'hover:opacity-90',
          isLoading && 'opacity-50'
        )}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={handleClick}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={recipeName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center">
            <span className="text-white text-4xl">🍽️</span>
          </div>
        )}

        {/* Hover overlay */}
        {editable && isHovering && !isLoading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-white text-center">
              <Camera className="w-8 h-8 mx-auto mb-1" />
              <span className="text-sm">Click to upload</span>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Action buttons */}
      {editable && (
        <div className="absolute top-2 right-2" ref={optionsRef}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowOptions((prev) => !prev)
            }}
            disabled={isLoading}
            className="flex items-center justify-center h-9 w-9 bg-white/90 text-gray-700 rounded-md hover:bg-white disabled:opacity-50"
            aria-label="Photo options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showOptions && (
            <div
              className="absolute right-0 mt-2 w-48 rounded-lg bg-white shadow-lg border border-gray-200 p-1 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  setShowOptions(false)
                  fileInputRef.current?.click()
                }}
                disabled={isLoading}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                Upload photo
              </button>
              <button
                onClick={() => {
                  setShowOptions(false)
                  findImageMutation.mutate()
                }}
                disabled={isLoading}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md disabled:opacity-50"
              >
                <Search className="w-4 h-4" />
                {photoUrl ? 'Find better image' : 'Find image'}
              </button>
              <button
                onClick={() => {
                  setShowOptions(false)
                  generateImageMutation.mutate()
                }}
                disabled={isLoading}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                Generate with AI
              </button>
              {photoUrl && (
                <button
                  onClick={() => {
                    setShowOptions(false)
                    setCrop({ x: 0, y: 0 })
                    setZoom(1)
                    setShowCropper(true)
                  }}
                  disabled={isLoading}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md disabled:opacity-50"
                >
                  <Crop className="w-4 h-4" />
                  Crop
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Crop Modal */}
      {showCropper && photoUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
          <div className="flex-1 relative">
            <Cropper
              image={photoUrl}
              crop={crop}
              zoom={zoom}
              aspect={4 / 3}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className="p-4 bg-gray-900 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="text-white text-sm">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-32"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCropper(false)}
                className="flex items-center gap-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button
                onClick={handleSaveCrop}
                disabled={saveCroppedMutation.isPending}
                className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50"
              >
                {saveCroppedMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<string | null> {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) return null

  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  )

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1]
        resolve(base64)
      }
      reader.readAsDataURL(blob)
    }, 'image/jpeg', 0.9)
  })
}

async function createImage(url: string): Promise<HTMLImageElement> {
  // For external URLs, fetch as blob to avoid CORS issues
  if (url.startsWith('http') && !url.startsWith('data:')) {
    try {
      const response = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`)
      const blob = await response.blob()
      url = URL.createObjectURL(blob)
    } catch (e) {
      console.error('Failed to proxy image:', e)
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}
