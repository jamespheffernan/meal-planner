'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { recipeImport } from '@/lib/api'
import { useState } from 'react'
import { Link2, Camera, Upload, FileText, Check, AlertCircle } from 'lucide-react'
import clsx from 'clsx'

type ImportMethod = 'url' | 'image' | 'paprika'

export default function ImportPage() {
  const queryClient = useQueryClient()
  const [method, setMethod] = useState<ImportMethod>('url')
  const [url, setUrl] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [paprikaFile, setPaprikaFile] = useState<File | null>(null)
  const [autoApprove, setAutoApprove] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const urlMutation = useMutation({
    mutationFn: () => recipeImport.fromUrl(url, autoApprove),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      setResult({ success: true, message: `Imported "${data.recipe.name}" successfully!` })
      setUrl('')
    },
    onError: (error: Error) => {
      setResult({ success: false, message: error.message })
    },
  })

  const imageMutation = useMutation({
    mutationFn: async () => {
      if (!imageFile) throw new Error('No file selected')
      const base64 = await fileToBase64(imageFile)
      return recipeImport.fromImage(base64, imageFile.type, autoApprove)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      setResult({ success: true, message: `Imported "${data.recipe.name}" successfully!` })
      setImageFile(null)
    },
    onError: (error: Error) => {
      setResult({ success: false, message: error.message })
    },
  })

  const paprikaMutation = useMutation({
    mutationFn: async () => {
      if (!paprikaFile) throw new Error('No file selected')
      const base64 = await fileToBase64(paprikaFile)
      return recipeImport.fromPaprika(base64, autoApprove)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      setResult({
        success: true,
        message: `Imported ${data.imported} recipes! ${data.duplicatesSkipped} duplicates skipped.`,
      })
      setPaprikaFile(null)
    },
    onError: (error: Error) => {
      setResult({ success: false, message: error.message })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setResult(null)

    if (method === 'url') {
      urlMutation.mutate()
    } else if (method === 'image') {
      imageMutation.mutate()
    } else if (method === 'paprika') {
      paprikaMutation.mutate()
    }
  }

  const isLoading = urlMutation.isPending || imageMutation.isPending || paprikaMutation.isPending

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Import Recipes</h1>

      {/* Method Selection */}
      <div className="flex gap-2">
        <MethodButton
          icon={Link2}
          label="From URL"
          active={method === 'url'}
          onClick={() => setMethod('url')}
        />
        <MethodButton
          icon={Camera}
          label="From Photo"
          active={method === 'image'}
          onClick={() => setMethod('image')}
        />
        <MethodButton
          icon={FileText}
          label="Paprika Import"
          active={method === 'paprika'}
          onClick={() => setMethod('paprika')}
        />
      </div>

      {/* Result Message */}
      {result && (
        <div className={clsx(
          'p-4 rounded-lg flex items-center gap-3',
          result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        )}>
          {result.success ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span>{result.message}</span>
        </div>
      )}

      {/* Import Forms */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        {method === 'url' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recipe URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/recipe"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
              <p className="text-sm text-gray-500 mt-1">
                Works best with sites that use schema.org markup (most popular recipe sites)
              </p>
            </div>
          </>
        )}

        {method === 'image' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recipe Photo
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                {imageFile ? (
                  <div className="space-y-2">
                    <p className="font-medium text-gray-900">{imageFile.name}</p>
                    <button
                      type="button"
                      onClick={() => setImageFile(null)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600 mb-2">Upload a photo of a recipe</p>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                      className="hidden"
                      id="image-upload"
                    />
                    <label
                      htmlFor="image-upload"
                      className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Choose file
                    </label>
                  </>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Supports cookbook pages, recipe cards, or handwritten recipes (uses AI to extract)
              </p>
            </div>
          </>
        )}

        {method === 'paprika' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Paprika Export File
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                {paprikaFile ? (
                  <div className="space-y-2">
                    <p className="font-medium text-gray-900">{paprikaFile.name}</p>
                    <button
                      type="button"
                      onClick={() => setPaprikaFile(null)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600 mb-2">Upload your Paprika export</p>
                    <input
                      type="file"
                      accept=".paprikarecipes,.json"
                      onChange={(e) => setPaprikaFile(e.target.files?.[0] || null)}
                      className="hidden"
                      id="paprika-upload"
                    />
                    <label
                      htmlFor="paprika-upload"
                      className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Choose file
                    </label>
                  </>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Export from Paprika: Settings → Export → All Recipes
              </p>
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="auto-approve"
            checked={autoApprove}
            onChange={(e) => setAutoApprove(e.target.checked)}
            className="rounded"
          />
          <label htmlFor="auto-approve" className="text-sm text-gray-700">
            Auto-approve imported recipes (skip discovery review)
          </label>
        </div>

        <button
          type="submit"
          disabled={isLoading || (method === 'url' && !url) || (method === 'image' && !imageFile) || (method === 'paprika' && !paprikaFile)}
          className="w-full py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Importing...' : 'Import'}
        </button>
      </form>
    </div>
  )
}

function MethodButton({ icon: Icon, label, active, onClick }: {
  icon: React.ElementType
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors',
        active ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
      )}
    >
      <Icon className="w-5 h-5" />
      {label}
    </button>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove data URL prefix
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
