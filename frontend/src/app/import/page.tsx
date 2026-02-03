'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { recipeImport, ParsedRecipe, ReceiptImportResult, ingredients } from '@/lib/api'
import { imageFileToBase64 } from '@/lib/image'
import { useState } from 'react'
import { Link2, Camera, Upload, FileText, Check, AlertCircle, X, Plus, Trash2, Edit3, Save, Receipt } from 'lucide-react'
import clsx from 'clsx'

type ImportMethod = 'url' | 'image' | 'paprika' | 'receipt'

export default function ImportPage() {
  const queryClient = useQueryClient()
  const [method, setMethod] = useState<ImportMethod>('url')
  const [url, setUrl] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [paprikaFile, setPaprikaFile] = useState<File | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptStoreName, setReceiptStoreName] = useState('')
  const [autoApprove, setAutoApprove] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  // Preview state for image import
  const [previewRecipes, setPreviewRecipes] = useState<ParsedRecipe[] | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [receiptResult, setReceiptResult] = useState<ReceiptImportResult | null>(null)

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

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!imageFile) throw new Error('No file selected')
      const { base64, mimeType } = await imageFileToBase64(imageFile, { maxSize: 2200, quality: 0.9 })
      return recipeImport.previewImage(base64, mimeType)
    },
    onSuccess: (data) => {
      setPreviewRecipes(data.recipes)
      setResult({ success: true, message: `Found ${data.count} recipe(s). Review and edit below.` })
    },
    onError: (error: Error) => {
      setResult({ success: false, message: error.message })
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!previewRecipes) throw new Error('No recipes to save')
      return recipeImport.saveRecipes(previewRecipes, autoApprove)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      setResult({ success: true, message: `Saved ${data.count} recipe(s) successfully!` })
      setPreviewRecipes(null)
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

  const receiptMutation = useMutation({
    mutationFn: async () => {
      if (!receiptFile) throw new Error('No file selected')
      const { base64, mimeType } = await imageFileToBase64(receiptFile, { maxSize: 2400, quality: 0.85 })
      return recipeImport.parseReceipt(base64, mimeType, receiptStoreName || undefined, false)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      setReceiptResult(data)
      setResult({
        success: true,
        message: `Parsed ${data.parsed.items.length} items. ${data.matchedItems.length} matched, ${data.unmatchedCount} unmatched.`,
      })
      setReceiptFile(null)
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
      previewMutation.mutate()
    } else if (method === 'paprika') {
      paprikaMutation.mutate()
    } else if (method === 'receipt') {
      receiptMutation.mutate()
    }
  }

  const updateRecipe = (index: number, updates: Partial<ParsedRecipe>) => {
    if (!previewRecipes) return
    const newRecipes = [...previewRecipes]
    newRecipes[index] = { ...newRecipes[index], ...updates }
    setPreviewRecipes(newRecipes)
  }

  const removeRecipe = (index: number) => {
    if (!previewRecipes) return
    setPreviewRecipes(previewRecipes.filter((_, i) => i !== index))
    if (editingIndex === index) setEditingIndex(null)
  }

  const isLoading = urlMutation.isPending || previewMutation.isPending || saveMutation.isPending || paprikaMutation.isPending || receiptMutation.isPending
  const [applySelection, setApplySelection] = useState<Record<string, boolean>>({})
  const [unmatchedSelections, setUnmatchedSelections] = useState<Record<string, string>>({})
  const [unmatchedSearch, setUnmatchedSearch] = useState<Record<string, string>>({})

  const applyMatchesMutation = useMutation({
    mutationFn: recipeImport.applyReceiptMatches,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
    },
  })

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Import Recipes</h1>

      {/* Method Selection */}
      <div className="flex gap-2">
        <MethodButton
          icon={Link2}
          label="From URL"
          active={method === 'url'}
          onClick={() => { setMethod('url'); setPreviewRecipes(null) }}
        />
        <MethodButton
          icon={Camera}
          label="From Photo"
          active={method === 'image'}
          onClick={() => { setMethod('image'); setPreviewRecipes(null) }}
        />
        <MethodButton
          icon={FileText}
          label="Paprika Import"
          active={method === 'paprika'}
          onClick={() => { setMethod('paprika'); setPreviewRecipes(null) }}
        />
        <MethodButton
          icon={Receipt}
          label="Receipt"
          active={method === 'receipt'}
          onClick={() => { setMethod('receipt'); setPreviewRecipes(null) }}
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

      {/* Preview/Edit Mode for Image Import */}
      {previewRecipes && previewRecipes.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Review Recipes ({previewRecipes.length})</h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setPreviewRecipes(null); setImageFile(null) }}
                className="px-4 py-2 text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? 'Saving...' : `Save ${previewRecipes.length} Recipe(s)`}
              </button>
            </div>
          </div>

          {previewRecipes.map((recipe, index) => (
            <RecipePreviewCard
              key={index}
              recipe={recipe}
              index={index}
              isEditing={editingIndex === index}
              onEdit={() => setEditingIndex(editingIndex === index ? null : index)}
              onUpdate={(updates) => updateRecipe(index, updates)}
              onRemove={() => removeRecipe(index)}
            />
          ))}

          <div className="flex items-center gap-2 p-4 bg-gray-50 rounded-lg">
            <input
              type="checkbox"
              id="auto-approve-preview"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="auto-approve-preview" className="text-sm text-gray-700">
              Auto-approve (skip discovery review)
            </label>
          </div>
        </div>
      ) : (
        /* Import Forms */
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
                      <p className="text-gray-600 mb-2">Upload a photo of recipes</p>
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
                  Supports multiple recipes per image. You can review and edit before saving.
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

          {method === 'receipt' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Receipt Photo
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                  {receiptFile ? (
                    <div className="space-y-2">
                      <p className="font-medium text-gray-900">{receiptFile.name}</p>
                      <button
                        type="button"
                        onClick={() => setReceiptFile(null)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-600 mb-2">Upload a grocery receipt</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                        className="hidden"
                        id="receipt-upload"
                      />
                      <label
                        htmlFor="receipt-upload"
                        className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Choose file
                      </label>
                    </>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Store Name (optional)
                </label>
                <input
                  type="text"
                  value={receiptStoreName}
                  onChange={(e) => setReceiptStoreName(e.target.value)}
                  placeholder="e.g., Tesco, Sainsbury's"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
            </>
          )}

          {method !== 'image' && method !== 'receipt' && (
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
          )}

          <button
            type="submit"
            disabled={isLoading || (method === 'url' && !url) || (method === 'image' && !imageFile) || (method === 'paprika' && !paprikaFile) || (method === 'receipt' && !receiptFile)}
            className="w-full py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (method === 'image' ? 'Scanning...' : 'Importing...') : (method === 'image' ? 'Scan & Preview' : 'Import')}
          </button>
        </form>
      )}

      {receiptResult && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Receipt Review</h2>
              <p className="text-sm text-gray-500">
                {receiptResult.receipt.storeName} · {new Date(receiptResult.receipt.purchaseDate).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => setReceiptResult(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500">Items</p>
              <p className="text-lg font-semibold">{receiptResult.parsed.items.length}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500">Matched</p>
              <p className="text-lg font-semibold">{receiptResult.matchedItems.length}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500">Unmatched</p>
              <p className="text-lg font-semibold">{receiptResult.unmatchedCount}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Matched Items</h3>
            {receiptResult.matchedItems.length > 0 ? (
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                {receiptResult.matchedItems.map((item, index) => (
                  <div key={`${item.ingredientId}-${index}`} className="p-3 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-gray-900">{item.receiptItem} → {item.matchedIngredient}</p>
                      <p className="text-xs text-gray-500">
                        Match: {item.matchScore ? Math.round(item.matchScore * 100) : 0}% ·
                        Qty: {item.receiptQuantity ?? 1} · Price: {item.receiptPrice ?? '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Suggested cost / unit</p>
                        <p className="font-medium text-gray-900">
                          {item.suggestedCostPerUnit !== null && item.suggestedCostPerUnit !== undefined ? `£${item.suggestedCostPerUnit.toFixed(2)}` : '—'}
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={applySelection[`${item.ingredientId}-${index}`] ?? true}
                          onChange={(e) => {
                            setApplySelection(prev => ({ ...prev, [`${item.ingredientId}-${index}`]: e.target.checked }))
                          }}
                        />
                        Apply
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No matched items.</p>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Unmatched Items</h3>
            {receiptResult.unmatchedItems.length > 0 ? (
              <div className="space-y-3">
                {receiptResult.unmatchedItems.map((item, index) => (
                  <UnmatchedRow
                    key={`${item.name}-${index}`}
                    item={item}
                    selectedIngredientId={unmatchedSelections[`${item.name}-${index}`]}
                    searchValue={unmatchedSearch[`${item.name}-${index}`] || ''}
                    onSearchChange={(value) => setUnmatchedSearch(prev => ({ ...prev, [`${item.name}-${index}`]: value }))}
                    onSelect={(id) => setUnmatchedSelections(prev => ({ ...prev, [`${item.name}-${index}`]: id }))}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No unmatched items.</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => {
                if (!receiptResult) return
                const matches: Array<{ ingredientId: string; price?: number; quantity?: number }> = []
                receiptResult.matchedItems.forEach((item, index) => {
                  const key = `${item.ingredientId}-${index}`
                  const apply = applySelection[key] ?? true
                  if (apply) {
                    matches.push({
                      ingredientId: item.ingredientId,
                      price: item.receiptPrice,
                      quantity: item.receiptQuantity,
                    })
                  }
                })

                receiptResult.unmatchedItems.forEach((item, index) => {
                  const key = `${item.name}-${index}`
                  const selectedId = unmatchedSelections[key]
                  if (selectedId) {
                    matches.push({
                      ingredientId: selectedId,
                      price: item.price,
                      quantity: item.quantity,
                    })
                  }
                })

                if (matches.length > 0) {
                  applyMatchesMutation.mutate(matches)
                }
              }}
              disabled={applyMatchesMutation.isPending}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {applyMatchesMutation.isPending ? 'Applying...' : 'Apply selected price updates'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function RecipePreviewCard({ recipe, index, isEditing, onEdit, onUpdate, onRemove }: {
  recipe: ParsedRecipe
  index: number
  isEditing: boolean
  onEdit: () => void
  onUpdate: (updates: Partial<ParsedRecipe>) => void
  onRemove: () => void
}) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm">
            {index + 1}
          </span>
          {isEditing ? (
            <input
              type="text"
              value={recipe.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="font-semibold text-gray-900 px-2 py-1 border rounded"
            />
          ) : (
            <h3 className="font-semibold text-gray-900">{recipe.name}</h3>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className={clsx(
              'p-2 rounded-lg transition-colors',
              isEditing ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-500'
            )}
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={onRemove}
            className="p-2 hover:bg-red-50 text-red-500 rounded-lg"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Meta info */}
        <div className="flex gap-4 text-sm text-gray-600">
          {isEditing ? (
            <>
              <label className="flex items-center gap-1">
                Servings:
                <input
                  type="number"
                  value={recipe.servings || ''}
                  onChange={(e) => onUpdate({ servings: parseInt(e.target.value) || undefined })}
                  className="w-16 px-2 py-1 border rounded"
                />
              </label>
              <label className="flex items-center gap-1">
                Cook time:
                <input
                  type="number"
                  value={recipe.cookTimeMinutes || ''}
                  onChange={(e) => onUpdate({ cookTimeMinutes: parseInt(e.target.value) || undefined })}
                  className="w-16 px-2 py-1 border rounded"
                />
                min
              </label>
              <label className="flex items-center gap-1">
                Prep time:
                <input
                  type="number"
                  value={recipe.prepTimeMinutes || ''}
                  onChange={(e) => onUpdate({ prepTimeMinutes: parseInt(e.target.value) || undefined })}
                  className="w-16 px-2 py-1 border rounded"
                />
                min
              </label>
            </>
          ) : (
            <>
              {recipe.servings && <span>Serves {recipe.servings}</span>}
              {recipe.cookTimeMinutes && <span>{recipe.cookTimeMinutes} min cook</span>}
              {recipe.prepTimeMinutes && <span>{recipe.prepTimeMinutes} min prep</span>}
            </>
          )}
        </div>

        {/* Description */}
        {(recipe.description || isEditing) && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-1">Description</h4>
            {isEditing ? (
              <textarea
                value={recipe.description || ''}
                onChange={(e) => onUpdate({ description: e.target.value })}
                className="w-full px-2 py-1 border rounded text-sm"
                rows={2}
              />
            ) : (
              <p className="text-sm text-gray-600">{recipe.description}</p>
            )}
          </div>
        )}

        {/* Ingredients */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Ingredients ({recipe.ingredients.length})
          </h4>
          <ul className="space-y-1">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-center gap-2">
                {isEditing ? (
                  <>
                    <input
                      type="number"
                      value={ing.quantity || ''}
                      onChange={(e) => {
                        const newIngs = [...recipe.ingredients]
                        newIngs[i] = { ...newIngs[i], quantity: parseFloat(e.target.value) || undefined }
                        onUpdate({ ingredients: newIngs })
                      }}
                      className="w-16 px-1 py-0.5 border rounded text-sm"
                      placeholder="Qty"
                    />
                    <input
                      type="text"
                      value={ing.unit || ''}
                      onChange={(e) => {
                        const newIngs = [...recipe.ingredients]
                        newIngs[i] = { ...newIngs[i], unit: e.target.value }
                        onUpdate({ ingredients: newIngs })
                      }}
                      className="w-20 px-1 py-0.5 border rounded text-sm"
                      placeholder="Unit"
                    />
                    <input
                      type="text"
                      value={ing.name}
                      onChange={(e) => {
                        const newIngs = [...recipe.ingredients]
                        newIngs[i] = { ...newIngs[i], name: e.target.value }
                        onUpdate({ ingredients: newIngs })
                      }}
                      className="flex-1 px-1 py-0.5 border rounded text-sm"
                    />
                    <button
                      onClick={() => {
                        const newIngs = recipe.ingredients.filter((_, idx) => idx !== i)
                        onUpdate({ ingredients: newIngs })
                      }}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <span>
                    • {ing.quantity} {ing.unit} {ing.name}
                    {ing.notes && <span className="text-gray-400"> ({ing.notes})</span>}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {isEditing && (
            <button
              onClick={() => {
                onUpdate({ ingredients: [...recipe.ingredients, { name: '', quantity: 1, unit: '' }] })
              }}
              className="mt-2 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add ingredient
            </button>
          )}
        </div>

        {/* Instructions */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Instructions ({recipe.instructions.length} steps)
          </h4>
          <ol className="space-y-2">
            {recipe.instructions.map((step, i) => (
              <li key={i} className="text-sm text-gray-600 flex gap-2">
                <span className="font-medium text-gray-400 shrink-0">{i + 1}.</span>
                {isEditing ? (
                  <div className="flex-1 flex gap-2">
                    <textarea
                      value={step}
                      onChange={(e) => {
                        const newSteps = [...recipe.instructions]
                        newSteps[i] = e.target.value
                        onUpdate({ instructions: newSteps })
                      }}
                      className="flex-1 px-2 py-1 border rounded text-sm"
                      rows={2}
                    />
                    <button
                      onClick={() => {
                        const newSteps = recipe.instructions.filter((_, idx) => idx !== i)
                        onUpdate({ instructions: newSteps })
                      }}
                      className="text-red-500 hover:text-red-700 shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <span>{step}</span>
                )}
              </li>
            ))}
          </ol>
          {isEditing && (
            <button
              onClick={() => {
                onUpdate({ instructions: [...recipe.instructions, ''] })
              }}
              className="mt-2 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add step
            </button>
          )}
        </div>
      </div>
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

function UnmatchedRow({
  item,
  selectedIngredientId,
  searchValue,
  onSearchChange,
  onSelect,
}: {
  item: { name: string; quantity?: number; unit?: string; price?: number }
  selectedIngredientId?: string
  searchValue: string
  onSearchChange: (value: string) => void
  onSelect: (id: string) => void
}) {
  const { data: ingredientList } = useQuery({
    queryKey: ['ingredients', 'receipt-match', searchValue],
    queryFn: () => ingredients.list({ search: searchValue }),
    enabled: searchValue.length > 0,
  })

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between text-sm">
        <div>
          <p className="font-medium text-gray-900">{item.name}</p>
          <p className="text-xs text-gray-500">
            Qty: {item.quantity ?? 1} {item.unit || ''} · Price: {item.price ?? '—'}
          </p>
        </div>
        {selectedIngredientId && (
          <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full">
            Mapped
          </span>
        )}
      </div>
      <div className="mt-2">
        <input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search ingredient to map..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        {ingredientList && ingredientList.length > 0 && (
          <div className="mt-2 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
            {ingredientList.map(ing => (
              <button
                key={ing.id}
                type="button"
                onClick={() => onSelect(ing.id)}
                className="w-full p-2 text-left hover:bg-gray-50 text-sm"
              >
                <p className="font-medium">{ing.name}</p>
                <p className="text-xs text-gray-500">{ing.category}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
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
