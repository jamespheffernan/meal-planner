'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ingredients, preferences } from '@/lib/api'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Heart, ThumbsDown, Settings, Trash2, X, Upload, Download } from 'lucide-react'
import clsx from 'clsx'
import type { Ingredient, Brand, CreateIngredientInput, CreateBrandInput } from '@/lib/api'

const INGREDIENT_CATEGORIES = [
  'staple',
  'perishable',
  'pantry',
  'produce',
  'meat',
  'dairy',
  'frozen',
]

const BRAND_PREFERENCES: CreateBrandInput['preferenceLevel'][] = ['preferred', 'acceptable', 'avoid']

export default function IngredientsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [manageIngredient, setManageIngredient] = useState<Ingredient | null>(null)
  const [expandedBrandsId, setExpandedBrandsId] = useState<string | null>(null)

  const { data: ingredientList, isLoading } = useQuery({
    queryKey: ['ingredients', search],
    queryFn: () => ingredients.list({ search: search.trim() || undefined }),
  })

  const { data: likedIngredients } = useQuery({
    queryKey: ['preferences', 'liked'],
    queryFn: preferences.getLikedIngredients,
  })

  const { data: dislikedIngredients } = useQuery({
    queryKey: ['preferences', 'disliked'],
    queryFn: preferences.getDislikedIngredients,
  })

  const likedIds = useMemo(() => new Set((likedIngredients || []).map(i => i.id)), [likedIngredients])
  const dislikedIds = useMemo(() => new Set((dislikedIngredients || []).map(i => i.id)), [dislikedIngredients])

  const createMutation = useMutation({
    mutationFn: ingredients.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      setShowAddModal(false)
    },
  })

  const bulkCreateMutation = useMutation({
    mutationFn: ingredients.bulkCreate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      setShowImportModal(false)
    },
  })

  const addLikeMutation = useMutation({
    mutationFn: preferences.addLike,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  const removeLikeMutation = useMutation({
    mutationFn: preferences.removeLike,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  const addDislikeMutation = useMutation({
    mutationFn: preferences.addDislike,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  const removeDislikeMutation = useMutation({
    mutationFn: preferences.removeDislike,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  const handleLikeToggle = async (ingredientId: string) => {
    if (likedIds.has(ingredientId)) {
      await removeLikeMutation.mutateAsync(ingredientId)
      return
    }
    if (dislikedIds.has(ingredientId)) {
      await removeDislikeMutation.mutateAsync(ingredientId)
    }
    await addLikeMutation.mutateAsync(ingredientId)
  }

  const handleDislikeToggle = async (ingredientId: string) => {
    if (dislikedIds.has(ingredientId)) {
      await removeDislikeMutation.mutateAsync(ingredientId)
      return
    }
    if (likedIds.has(ingredientId)) {
      await removeLikeMutation.mutateAsync(ingredientId)
    }
    await addDislikeMutation.mutateAsync(ingredientId)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ingredients</h1>
          <p className="text-sm text-gray-500">Manage your ingredient database, brands, and preferences.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button
            onClick={() => exportIngredientsCsv(ingredientList || [])}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={() => exportIngredientsJson(ingredientList || [])}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            <Download className="w-4 h-4" />
            Export JSON
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
          >
            <Plus className="w-4 h-4" />
            Add Ingredient
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 flex items-center gap-3">
        <Search className="w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ingredients..."
          className="flex-1 outline-none text-sm"
        />
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading ingredients...</p>
      ) : ingredientList && ingredientList.length > 0 ? (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {ingredientList.map(ingredient => {
            const isLiked = likedIds.has(ingredient.id)
            const isDisliked = dislikedIds.has(ingredient.id)
            const isExpanded = expandedBrandsId === ingredient.id
            return (
              <div key={ingredient.id}>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <Link href={`/ingredients/${ingredient.id}`} className="font-medium text-gray-900 hover:underline">
                      {ingredient.name}
                    </Link>
                    <p className="text-sm text-gray-500">
                      {ingredient.category} · {ingredient.typicalUnit}
                      {ingredient.brands?.length ? ` · ${ingredient.brands.length} brand${ingredient.brands.length > 1 ? 's' : ''}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleLikeToggle(ingredient.id)}
                      className={clsx(
                        'px-2 py-1 rounded text-xs flex items-center gap-1',
                        isLiked ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      )}
                    >
                      <Heart className="w-3 h-3" />
                      Like
                    </button>
                    <button
                      onClick={() => handleDislikeToggle(ingredient.id)}
                      className={clsx(
                        'px-2 py-1 rounded text-xs flex items-center gap-1',
                        isDisliked ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      )}
                    >
                      <ThumbsDown className="w-3 h-3" />
                      Dislike
                    </button>
                    <button
                      onClick={() => setExpandedBrandsId(isExpanded ? null : ingredient.id)}
                      className="px-2 py-1 rounded text-xs flex items-center gap-1 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                    >
                      Brands
                    </button>
                    <button
                      onClick={() => setManageIngredient(ingredient)}
                      className="px-2 py-1 rounded text-xs flex items-center gap-1 bg-gray-900 text-white hover:bg-gray-800"
                    >
                      <Settings className="w-3 h-3" />
                      Manage
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <InlineBrandEditor
                    ingredient={ingredient}
                    onClose={() => setExpandedBrandsId(null)}
                  />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-600 mb-4">No ingredients found.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
          >
            Add your first ingredient
          </button>
        </div>
      )}

      {showAddModal && (
        <AddIngredientModal
          onClose={() => setShowAddModal(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isSaving={createMutation.isPending}
        />
      )}

      {showImportModal && (
        <ImportIngredientsModal
          onClose={() => setShowImportModal(false)}
          onImport={(data) => bulkCreateMutation.mutate(data)}
          isImporting={bulkCreateMutation.isPending}
        />
      )}

      {manageIngredient && (
        <ManageIngredientModal
          ingredient={manageIngredient}
          onClose={() => setManageIngredient(null)}
        />
      )}
    </div>
  )
}

function AddIngredientModal({
  onClose,
  onCreate,
  isSaving,
}: {
  onClose: () => void
  onCreate: (data: CreateIngredientInput) => void
  isSaving: boolean
}) {
  const [form, setForm] = useState<CreateIngredientInput>({
    name: '',
    category: 'pantry',
    typicalUnit: 'piece',
  })
  const [calories, setCalories] = useState('')
  const [cost, setCost] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onCreate({
      ...form,
      estimatedCaloriesPerUnit: calories ? parseFloat(calories) : undefined,
      estimatedCostPerUnit: cost ? parseFloat(cost) : undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Add Ingredient</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              >
                {INGREDIENT_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Typical Unit</label>
              <input
                type="text"
                value={form.typicalUnit}
                onChange={(e) => setForm({ ...form, typicalUnit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Calories/Unit</label>
              <input
                type="number"
                step="0.01"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost/Unit (£)</label>
              <input
                type="number"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Create Ingredient'}
          </button>
        </form>
      </div>
    </div>
  )
}

function ManageIngredientModal({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { data: ingredientDetails } = useQuery({
    queryKey: ['ingredient', ingredient.id],
    queryFn: () => ingredients.get(ingredient.id),
  })
  const [form, setForm] = useState<CreateIngredientInput>({
    name: ingredient.name,
    category: ingredient.category,
    typicalUnit: ingredient.typicalUnit,
    estimatedCaloriesPerUnit: ingredient.estimatedCaloriesPerUnit,
    estimatedCostPerUnit: ingredient.estimatedCostPerUnit,
  })
  const [brandForm, setBrandForm] = useState<CreateBrandInput>({
    brandName: '',
    preferenceLevel: 'preferred',
    notes: '',
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateIngredientInput>) => ingredients.update(ingredient.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      queryClient.invalidateQueries({ queryKey: ['ingredient', ingredient.id] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => ingredients.delete(ingredient.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      queryClient.invalidateQueries({ queryKey: ['ingredient', ingredient.id] })
      onClose()
    },
  })

  const addBrandMutation = useMutation({
    mutationFn: (data: CreateBrandInput) => ingredients.addBrand(ingredient.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      queryClient.invalidateQueries({ queryKey: ['ingredient', ingredient.id] })
      setBrandForm({ brandName: '', preferenceLevel: 'preferred', notes: '' })
    },
  })

  const deleteBrandMutation = useMutation({
    mutationFn: (brandId: string) => ingredients.deleteBrand(ingredient.id, brandId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      queryClient.invalidateQueries({ queryKey: ['ingredient', ingredient.id] })
    },
  })

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    updateMutation.mutate({
      name: form.name,
      category: form.category,
      typicalUnit: form.typicalUnit,
      estimatedCaloriesPerUnit: form.estimatedCaloriesPerUnit,
      estimatedCostPerUnit: form.estimatedCostPerUnit,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Manage Ingredient</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                >
                  {INGREDIENT_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Typical Unit</label>
                <input
                  type="text"
                  value={form.typicalUnit}
                  onChange={(e) => setForm({ ...form, typicalUnit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Calories/Unit</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.estimatedCaloriesPerUnit ?? ''}
                  onChange={(e) => setForm({ ...form, estimatedCaloriesPerUnit: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost/Unit (£)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.estimatedCostPerUnit ?? ''}
                  onChange={(e) => setForm({ ...form, estimatedCostPerUnit: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
                Delete Ingredient
              </button>
            </div>
          </form>

          <div className="border-t border-gray-200 pt-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Brand Priorities</h3>
            {(ingredientDetails?.brands || ingredient.brands) && (ingredientDetails?.brands || ingredient.brands || []).length > 0 ? (
              <div className="space-y-2">
                {(ingredientDetails?.brands || ingredient.brands || []).map((brand: Brand) => (
                  <div key={brand.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{brand.brandName}</p>
                      <p className="text-xs text-gray-500">{brand.preferenceLevel}{brand.notes ? ` · ${brand.notes}` : ''}</p>
                    </div>
                    <button
                      onClick={() => deleteBrandMutation.mutate(brand.id)}
                      className="text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No brand preferences yet.</p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!brandForm.brandName.trim()) return
                addBrandMutation.mutate({
                  brandName: brandForm.brandName.trim(),
                  preferenceLevel: brandForm.preferenceLevel,
                  notes: brandForm.notes || undefined,
                })
              }}
              className="grid grid-cols-3 gap-3"
            >
              <input
                type="text"
                placeholder="Brand name"
                value={brandForm.brandName}
                onChange={(e) => setBrandForm({ ...brandForm, brandName: e.target.value })}
                className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <select
                value={brandForm.preferenceLevel}
                onChange={(e) => setBrandForm({ ...brandForm, preferenceLevel: e.target.value as CreateBrandInput['preferenceLevel'] })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {BRAND_PREFERENCES.map(level => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Notes (optional)"
                value={brandForm.notes || ''}
                onChange={(e) => setBrandForm({ ...brandForm, notes: e.target.value })}
                className="col-span-3 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <button
                type="submit"
                disabled={addBrandMutation.isPending}
                className="col-span-3 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                {addBrandMutation.isPending ? 'Adding...' : 'Add Brand'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

function InlineBrandEditor({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [brandForm, setBrandForm] = useState<CreateBrandInput>({
    brandName: '',
    preferenceLevel: 'preferred',
    notes: '',
  })

  const addBrandMutation = useMutation({
    mutationFn: (data: CreateBrandInput) => ingredients.addBrand(ingredient.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      setBrandForm({ brandName: '', preferenceLevel: 'preferred', notes: '' })
    },
  })

  const deleteBrandMutation = useMutation({
    mutationFn: (brandId: string) => ingredients.deleteBrand(ingredient.id, brandId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
    },
  })

  return (
    <div className="px-4 pb-4">
      <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-700 uppercase">Brand Priorities</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        {ingredient.brands && ingredient.brands.length > 0 ? (
          <div className="space-y-2">
            {ingredient.brands.map((brand: Brand) => (
              <div key={brand.id} className="flex items-center justify-between bg-white px-3 py-2 rounded">
                <div>
                  <p className="text-sm font-medium text-gray-900">{brand.brandName}</p>
                  <p className="text-xs text-gray-500">{brand.preferenceLevel}{brand.notes ? ` · ${brand.notes}` : ''}</p>
                </div>
                <button
                  onClick={() => deleteBrandMutation.mutate(brand.id)}
                  className="text-red-500 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No brand preferences yet.</p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!brandForm.brandName.trim()) return
            addBrandMutation.mutate({
              brandName: brandForm.brandName.trim(),
              preferenceLevel: brandForm.preferenceLevel,
              notes: brandForm.notes || undefined,
            })
          }}
          className="grid grid-cols-3 gap-2"
        >
          <input
            type="text"
            placeholder="Brand name"
            value={brandForm.brandName}
            onChange={(e) => setBrandForm({ ...brandForm, brandName: e.target.value })}
            className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <select
            value={brandForm.preferenceLevel}
            onChange={(e) => setBrandForm({ ...brandForm, preferenceLevel: e.target.value as CreateBrandInput['preferenceLevel'] })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {BRAND_PREFERENCES.map(level => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Notes (optional)"
            value={brandForm.notes || ''}
            onChange={(e) => setBrandForm({ ...brandForm, notes: e.target.value })}
            className="col-span-3 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <button
            type="submit"
            disabled={addBrandMutation.isPending}
            className="col-span-3 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            {addBrandMutation.isPending ? 'Adding...' : 'Add Brand'}
          </button>
        </form>
      </div>
    </div>
  )
}

function ImportIngredientsModal({
  onClose,
  onImport,
  isImporting,
}: {
  onClose: () => void
  onImport: (data: { ingredients: CreateIngredientInput[] }) => void
  isImporting: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleImport = async () => {
    if (!file) return
    try {
      const text = await file.text()
      const ingredients = parseIngredientImport(text, file.name)
      onImport({ ingredients })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Import Ingredients</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            type="file"
            accept=".json,.csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <p className="text-xs text-gray-500">
            Supports JSON array or CSV with columns: name, category, typicalUnit, estimatedCaloriesPerUnit, estimatedCostPerUnit
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={handleImport}
            disabled={!file || isImporting}
            className="w-full py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

function parseIngredientImport(text: string, filename: string): CreateIngredientInput[] {
  if (filename.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      throw new Error('JSON must be an array of ingredients')
    }
    return parsed.map(normalizeImportedIngredient)
  }

  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one ingredient')
  }
  const header = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim())
    const record: Record<string, string> = {}
    header.forEach((key, idx) => {
      record[key] = cols[idx] || ''
    })
    return normalizeImportedIngredient(record)
  })
}

function normalizeImportedIngredient(record: any): CreateIngredientInput {
  const name = record.name || record.Name
  const category = (record.category || record.Category || 'pantry').toLowerCase()
  const typicalUnit = record.typicalUnit || record.TypicalUnit || record.unit || record.Unit || 'piece'
  const calories = record.estimatedCaloriesPerUnit ?? record.Calories
  const cost = record.estimatedCostPerUnit ?? record.Cost

  if (!name) {
    throw new Error('Ingredient name is required')
  }

  return {
    name: String(name).trim(),
    category,
    typicalUnit: String(typicalUnit).trim(),
    estimatedCaloriesPerUnit: calories !== undefined && calories !== '' ? parseFloat(calories) : undefined,
    estimatedCostPerUnit: cost !== undefined && cost !== '' ? parseFloat(cost) : undefined,
  }
}

function exportIngredientsCsv(items: Ingredient[]) {
  const headers = ['name', 'category', 'typicalUnit', 'estimatedCaloriesPerUnit', 'estimatedCostPerUnit']
  const rows = items.map(item => [
    item.name,
    item.category,
    item.typicalUnit,
    item.estimatedCaloriesPerUnit ?? '',
    item.estimatedCostPerUnit ?? '',
  ])
  const csv = [headers.join(','), ...rows.map(r => r.map(String).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ingredients.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function exportIngredientsJson(items: Ingredient[]) {
  const payload = items.map(item => ({
    name: item.name,
    category: item.category,
    typicalUnit: item.typicalUnit,
    estimatedCaloriesPerUnit: item.estimatedCaloriesPerUnit ?? null,
    estimatedCostPerUnit: item.estimatedCostPerUnit ?? null,
  }))
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ingredients.json'
  a.click()
  URL.revokeObjectURL(url)
}
