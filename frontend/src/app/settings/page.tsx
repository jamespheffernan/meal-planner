'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { preferences, ingredients, settings, discovery, budget, staples, type DiscoverySourceInput, type StapleSuggestion } from '@/lib/api'
import { useEffect, useState } from 'react'
import { Save, X, Plus, Heart } from 'lucide-react'
import type { UserPreferences } from '@/lib/api'

const DAYS_OF_WEEK = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
]

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  const maybe = e as { message?: unknown }
  if (maybe && typeof maybe.message === 'string') return maybe.message
  try {
    return JSON.stringify(e)
  } catch {
    return 'Unknown error'
  }
}

export default function SettingsPage() {
  const queryClient = useQueryClient()

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['preferences'],
    queryFn: preferences.get,
  })

  const { data: dislikedIngredients } = useQuery({
    queryKey: ['preferences', 'disliked'],
    queryFn: preferences.getDislikedIngredients,
  })

  const { data: likedIngredients } = useQuery({
    queryKey: ['preferences', 'liked'],
    queryFn: preferences.getLikedIngredients,
  })

  const { data: openaiStatus } = useQuery({
    queryKey: ['settings', 'openai-key'],
    queryFn: settings.getOpenAIKeyStatus,
  })

  const { data: budgetSummary } = useQuery({
    queryKey: ['budget', 'summary', 8],
    queryFn: () => budget.summary(8),
  })

  const { data: ocadoSessionStatus } = useQuery({
    queryKey: ['settings', 'store-session', 'ocado'],
    queryFn: () => settings.getStoreSessionStatus('ocado'),
  })

  const RECIPE_AUTH_HOST = 'cooking.nytimes.com'
  const { data: recipeAuthStatus } = useQuery({
    queryKey: ['settings', 'recipe-auth-cookie', RECIPE_AUTH_HOST],
    queryFn: () => settings.getRecipeAuthCookie(RECIPE_AUTH_HOST),
  })

  const { data: discoverySources } = useQuery({
    queryKey: ['discovery', 'sources'],
    queryFn: discovery.listSources,
  })

  const { data: stapleSuggestions } = useQuery({
    queryKey: ['staples', 'suggestions', 12],
    queryFn: () => staples.suggestions(12),
  })

  const [formData, setFormData] = useState<Partial<UserPreferences>>({})
  const [showDislikeModal, setShowDislikeModal] = useState(false)
  const [showLikeModal, setShowLikeModal] = useState(false)
  const [openAiKey, setOpenAiKey] = useState('')
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState(false)
  const [saveKeyMessage, setSaveKeyMessage] = useState<string | null>(null)

  const [ocadoStorageStateText, setOcadoStorageStateText] = useState('')
  const [ocadoSessionMessage, setOcadoSessionMessage] = useState<string | null>(null)
  const [ocadoSessionError, setOcadoSessionError] = useState(false)

  const [selectedStaples, setSelectedStaples] = useState<Record<string, boolean>>({})

  const [recipeCookie, setRecipeCookie] = useState('')
  const [recipeCookieMessage, setRecipeCookieMessage] = useState<string | null>(null)
  const [recipeCookieError, setRecipeCookieError] = useState(false)

  const [sourceEdits, setSourceEdits] = useState<DiscoverySourceInput[]>([])
  const [sourceMessage, setSourceMessage] = useState<string | null>(null)

  useEffect(() => {
    if (discoverySources?.sources) {
      setSourceEdits(discoverySources.sources.map(source => ({
        host: source.host,
        displayName: source.displayName || '',
        enabled: source.enabled,
        sitemapUrls: source.sitemapUrls || [],
        rssUrls: source.rssUrls || [],
        weight: source.weight || 1,
      })))
    }
  }, [discoverySources?.sources])

  useEffect(() => {
    const list = stapleSuggestions?.suggestions || []
    if (list.length === 0) return
    setSelectedStaples(prev => {
      // Only initialize if nothing selected yet.
      if (Object.keys(prev).length > 0) return prev
      const next: Record<string, boolean> = {}
      list.forEach((s: StapleSuggestion) => {
        next[s.normalizedName] = s.confidence === 'high'
      })
      return next
    })
  }, [stapleSuggestions?.suggestions])

  const updateMutation = useMutation({
    mutationFn: preferences.update,
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

  const removeLikeMutation = useMutation({
    mutationFn: preferences.removeLike,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  const saveOpenAiKeyMutation = useMutation({
    mutationFn: settings.setOpenAIKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'openai-key'] })
      setOpenAiKey('')
      setSaveKeyMessage('Saved.')
    },
    onError: (error: unknown) => {
      setSaveKeyMessage(errorMessage(error) || 'Failed to save key')
    },
  })

  const clearOpenAiKeyMutation = useMutation({
    mutationFn: settings.clearOpenAIKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'openai-key'] })
    },
  })

  const verifyOpenAiKeyMutation = useMutation({
    mutationFn: (apiKey?: string) => settings.verifyOpenAIKey(apiKey),
    onSuccess: (data) => {
      setVerifyError(false)
      setVerifyMessage(data.model ? `Verified. Model: ${data.model}` : 'Verified.')
    },
    onError: (error: unknown) => {
      setVerifyError(true)
      setVerifyMessage(errorMessage(error) || 'Failed to verify key')
    },
  })

  const saveRecipeCookieMutation = useMutation({
    mutationFn: () => settings.setRecipeAuthCookie(RECIPE_AUTH_HOST, recipeCookie),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'recipe-auth-cookie', RECIPE_AUTH_HOST] })
      setRecipeCookie('')
      setRecipeCookieError(false)
      setRecipeCookieMessage('Saved.')
    },
    onError: (error: unknown) => {
      setRecipeCookieError(true)
      setRecipeCookieMessage(errorMessage(error) || 'Failed to save cookie')
    },
  })

  const clearRecipeCookieMutation = useMutation({
    mutationFn: () => settings.clearRecipeAuthCookie(RECIPE_AUTH_HOST),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'recipe-auth-cookie', RECIPE_AUTH_HOST] })
    },
  })

  const saveOcadoSessionMutation = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(ocadoStorageStateText)
      return settings.setStoreSession('ocado', parsed)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'store-session', 'ocado'] })
      setOcadoStorageStateText('')
      setOcadoSessionError(false)
      setOcadoSessionMessage('Saved.')
    },
    onError: (error: unknown) => {
      setOcadoSessionError(true)
      setOcadoSessionMessage(errorMessage(error) || 'Failed to save session')
    },
  })

  const clearOcadoSessionMutation = useMutation({
    mutationFn: () => settings.clearStoreSession('ocado'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'store-session', 'ocado'] })
    },
  })

  const confirmStaplesMutation = useMutation({
    mutationFn: (names: string[]) => staples.confirm(names),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staples', 'suggestions'] })
    },
  })

  const saveSourcesMutation = useMutation({
    mutationFn: (sources: DiscoverySourceInput[]) => discovery.saveSources(sources),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery', 'sources'] })
      setSourceMessage('Saved.')
    },
    onError: (error: unknown) => {
      setSourceMessage(errorMessage(error) || 'Failed to save sources')
    },
  })

  const updateSource = (index: number, patch: Partial<DiscoverySourceInput>) => {
    setSourceEdits(prev => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }

  const addSource = () => {
    setSourceEdits(prev => ([
      ...prev,
      { host: '', displayName: '', enabled: true, sitemapUrls: [], rssUrls: [], weight: 1 },
    ]))
  }

  const removeSource = (index: number) => {
    setSourceEdits(prev => prev.filter((_, i) => i !== index))
  }

  const parseList = (value: string) => value
    .split(/[,\\n]/)
    .map(item => item.trim())
    .filter(Boolean)

  const listToString = (list?: string[]) => (list || []).join('\\n')

  const handleSave = () => {
    updateMutation.mutate(formData)
  }

  const handleChange = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  if (isLoading) {
    return <p className="text-gray-500">Loading settings...</p>
  }

  const currentPrefs = { ...prefs, ...formData }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending || Object.keys(formData).length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>

      {/* Budget & Nutrition */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Budget & Nutrition</h2>

        {budgetSummary?.sampleSize ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            Typical weekly spend (from {budgetSummary.sampleSize} week{budgetSummary.sampleSize === 1 ? '' : 's'}):{' '}
            <span className="font-semibold">£{budgetSummary.typicalWeekly.toFixed(2)}</span>{' '}
            <span className="text-xs text-gray-500">({budgetSummary.confidence} confidence)</span>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            No purchase history yet. Import Grocery Getter history or log purchase orders to enable budget intelligence.
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Weekly Budget (£)
            </label>
            <input
              type="number"
              value={currentPrefs.budgetTargetWeekly || ''}
              onChange={(e) => handleChange('budgetTargetWeekly', e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="e.g., 100"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Daily Calories
            </label>
            <input
              type="number"
              value={currentPrefs.calorieTargetDaily || ''}
              onChange={(e) => handleChange('calorieTargetDaily', e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="e.g., 2000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>
      </section>

      {/* AI Settings */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">AI Settings</h2>
        <p className="text-sm text-gray-600">
          Your OpenAI key is stored encrypted in the database so OCR, nutrition estimates, and
          AI image generation work across restarts.
        </p>
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900">OpenAI API Key</p>
            <p className="text-xs text-gray-600">
              Status: {openaiStatus?.hasKey ? 'Configured' : 'Not set'}
              {openaiStatus?.source ? ` (${openaiStatus.source})` : ''}
            </p>
          </div>
          {openaiStatus?.source === 'db' && (
            <button
              onClick={() => clearOpenAiKeyMutation.mutate()}
              disabled={clearOpenAiKeyMutation.isPending}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Clear
            </button>
          )}
        </div>
        {!openaiStatus?.encryptionReady && (
          <p className="text-sm text-red-600">
            Cannot store keys yet. Set `MEAL_PLANNER_ENCRYPTION_KEY` in `backend/.env` and restart the server.
          </p>
        )}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Paste new key
          </label>
          <input
            type="password"
            value={openAiKey}
            onChange={(e) => setOpenAiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSaveKeyMessage(null)
                saveOpenAiKeyMutation.mutate(openAiKey)
              }}
              disabled={!openAiKey.trim() || saveOpenAiKeyMutation.isPending || !openaiStatus?.encryptionReady}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              Save Key
            </button>
            <button
              onClick={() => {
                setVerifyMessage(null)
                setVerifyError(false)
                verifyOpenAiKeyMutation.mutate(openAiKey.trim() ? openAiKey : undefined)
              }}
              disabled={verifyOpenAiKeyMutation.isPending || (!openAiKey.trim() && !openaiStatus?.hasKey)}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {verifyOpenAiKeyMutation.isPending ? 'Verifying...' : 'Verify Key'}
            </button>
            {saveOpenAiKeyMutation.isError && (
              <p className="text-sm text-red-600">
                {saveKeyMessage || 'Failed to save key.'}
              </p>
            )}
          </div>
          {!saveOpenAiKeyMutation.isError && saveKeyMessage && (
            <p className="text-sm text-green-700">{saveKeyMessage}</p>
          )}
          {verifyMessage && (
            <p className={`text-sm ${verifyError ? 'text-red-600' : 'text-green-700'}`}>
              {verifyMessage}
            </p>
          )}
        </div>
      </section>

      {/* NYT Auth Cookie */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">NYT Cooking Access</h2>
        <p className="text-sm text-gray-600">
          Store a cookie for `cooking.nytimes.com` to access paywalled recipes.
        </p>
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900">NYT Cookie</p>
            <p className="text-xs text-gray-600">
              Status: {recipeAuthStatus?.hasCookie ? 'Configured' : 'Not set'}
            </p>
          </div>
          {recipeAuthStatus?.hasCookie && (
            <button
              onClick={() => clearRecipeCookieMutation.mutate()}
              disabled={clearRecipeCookieMutation.isPending}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Clear
            </button>
          )}
        </div>
        {!recipeAuthStatus?.encryptionReady && (
          <p className="text-sm text-red-600">
            Cannot store cookies yet. Set `MEAL_PLANNER_ENCRYPTION_KEY` in `backend/.env` and restart the server.
          </p>
        )}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Paste cookie value
          </label>
          <input
            type="password"
            value={recipeCookie}
            onChange={(e) => setRecipeCookie(e.target.value)}
            placeholder="NYT cookie..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setRecipeCookieMessage(null)
                setRecipeCookieError(false)
                saveRecipeCookieMutation.mutate()
              }}
              disabled={!recipeCookie.trim() || saveRecipeCookieMutation.isPending || !recipeAuthStatus?.encryptionReady}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              Save Cookie
            </button>
            {saveRecipeCookieMutation.isError && (
              <p className="text-sm text-red-600">
                {recipeCookieMessage || 'Failed to save cookie.'}
              </p>
            )}
          </div>
          {!saveRecipeCookieMutation.isError && recipeCookieMessage && (
            <p className={`text-sm ${recipeCookieError ? 'text-red-600' : 'text-green-700'}`}>
              {recipeCookieMessage}
            </p>
          )}
        </div>
      </section>

      {/* Online Ordering */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Online Ordering</h2>
        <p className="text-sm text-gray-600">
          Connect Ocado by saving a Playwright <code className="px-1 py-0.5 bg-gray-100 rounded">storageState</code> JSON.
          This is stored encrypted in your database.
        </p>

        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900">Ocado session</p>
            <p className="text-xs text-gray-600">
              Status: {ocadoSessionStatus?.hasSession ? 'Connected' : 'Not connected'}
            </p>
          </div>
          {ocadoSessionStatus?.hasSession && (
            <button
              onClick={() => clearOcadoSessionMutation.mutate()}
              disabled={clearOcadoSessionMutation.isPending}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Clear
            </button>
          )}
        </div>

        {!ocadoSessionStatus?.encryptionReady && (
          <p className="text-sm text-red-600">
            Cannot store sessions yet. Set <code className="px-1 py-0.5 bg-gray-100 rounded">MEAL_PLANNER_ENCRYPTION_KEY</code> in <code className="px-1 py-0.5 bg-gray-100 rounded">backend/.env</code> and restart the server.
          </p>
        )}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Paste storageState JSON
          </label>
          <textarea
            value={ocadoStorageStateText}
            onChange={(e) => setOcadoStorageStateText(e.target.value)}
            placeholder='{"cookies":[...],"origins":[...]}'
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setOcadoSessionMessage(null)
                setOcadoSessionError(false)
                saveOcadoSessionMutation.mutate()
              }}
              disabled={!ocadoStorageStateText.trim() || saveOcadoSessionMutation.isPending || !ocadoSessionStatus?.encryptionReady}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              Save Session
            </button>
            <input
              type="file"
              accept="application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const text = await file.text()
                setOcadoStorageStateText(text)
              }}
              className="text-sm"
            />
          </div>
          {ocadoSessionMessage && (
            <p className={`text-sm ${ocadoSessionError ? 'text-red-600' : 'text-green-700'}`}>
              {ocadoSessionMessage}
            </p>
          )}
        </div>
      </section>

      {/* Staples Suggestions */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Staples (Suggestions)</h2>
        <p className="text-sm text-gray-600">
          These are detected from your purchase history. Confirming a staple makes it eligible for auto-inclusion later.
        </p>

        {stapleSuggestions?.suggestions?.length ? (
          <div className="space-y-2">
            {stapleSuggestions.suggestions.slice(0, 12).map(s => (
              <label key={s.normalizedName} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{s.normalizedName}</p>
                  <p className="text-xs text-gray-600">
                    {s.purchaseCount} buys · ~{s.avgIntervalDays}d cadence · {s.confidence} confidence
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(selectedStaples[s.normalizedName])}
                  onChange={(e) => setSelectedStaples(prev => ({ ...prev, [s.normalizedName]: e.target.checked }))}
                  className="h-4 w-4"
                />
              </label>
            ))}

            <button
              onClick={() => {
                const names = Object.entries(selectedStaples).filter(([, v]) => v).map(([k]) => k)
                confirmStaplesMutation.mutate(names)
              }}
              disabled={confirmStaplesMutation.isPending}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {confirmStaplesMutation.isPending ? 'Saving...' : 'Confirm Selected Staples'}
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            No suggestions yet. Import Grocery Getter order history or add purchase orders to build signals.
          </div>
        )}
      </section>

      {/* Discovery Sources */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Discovery Sources</h2>
            <p className="text-sm text-gray-600">Manage sitemaps and RSS feeds for theme search.</p>
          </div>
          <button
            onClick={addSource}
            className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
          >
            Add Source
          </button>
        </div>

        <div className="space-y-4">
          {sourceEdits.map((source, index) => (
            <div key={`${source.host}-${index}`} className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={source.enabled ?? true}
                    onChange={(e) => updateSource(index, { enabled: e.target.checked })}
                  />
                  <span className="text-sm text-gray-700">Enabled</span>
                </div>
                <button
                  onClick={() => removeSource(index)}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Host</label>
                  <input
                    value={source.host}
                    onChange={(e) => updateSource(index, { host: e.target.value })}
                    placeholder="example.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Display Name</label>
                  <input
                    value={source.displayName || ''}
                    onChange={(e) => updateSource(index, { displayName: e.target.value })}
                    placeholder="Friendly name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Weight</label>
                  <input
                    type="number"
                    min={1}
                    value={source.weight ?? 1}
                    onChange={(e) => updateSource(index, { weight: e.target.value ? parseInt(e.target.value, 10) : 1 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Sitemap URLs</label>
                  <textarea
                    rows={3}
                    value={listToString(source.sitemapUrls)}
                    onChange={(e) => updateSource(index, { sitemapUrls: parseList(e.target.value) })}
                    placeholder="https://example.com/sitemap.xml"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">RSS URLs</label>
                  <textarea
                    rows={3}
                    value={listToString(source.rssUrls)}
                    onChange={(e) => updateSource(index, { rssUrls: parseList(e.target.value) })}
                    placeholder="https://example.com/rss.xml"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => saveSourcesMutation.mutate(sourceEdits)}
            disabled={saveSourcesMutation.isPending}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            Save Sources
          </button>
          {sourceMessage && (
            <p className="text-sm text-gray-600">{sourceMessage}</p>
          )}
        </div>
      </section>

      {/* Shopping */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Shopping</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Default Shopping Day
          </label>
          <select
            value={currentPrefs.defaultShoppingDay || ''}
            onChange={(e) => handleChange('defaultShoppingDay', e.target.value || undefined)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          >
            <option value="">No preference</option>
            {DAYS_OF_WEEK.map(day => (
              <option key={day.value} value={day.value}>{day.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Measurement System
          </label>
          <div className="flex gap-3">
            {[
              { value: 'us', label: 'US Customary', desc: 'cups, tbsp, oz, lb' },
              { value: 'metric', label: 'Metric', desc: 'ml, L, g, kg' },
            ].map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleChange('measurementSystem', option.value as 'us' | 'metric')}
                className={`flex-1 p-3 rounded-lg border-2 text-left transition-colors ${
                  (currentPrefs.measurementSystem || 'us') === option.value
                    ? 'border-gray-900 bg-gray-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className="font-medium text-sm text-gray-900">{option.label}</p>
                <p className="text-xs text-gray-500">{option.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Dietary Restrictions */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Dietary Restrictions</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Restrictions (comma-separated)
          </label>
          <input
            type="text"
            value={(currentPrefs.dietaryRestrictions || []).join(', ')}
            onChange={(e) => handleChange('dietaryRestrictions', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            placeholder="e.g., vegetarian, gluten-free, nut allergy"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Preferred Cuisines (comma-separated)
          </label>
          <input
            type="text"
            value={(currentPrefs.preferredCuisines || []).join(', ')}
            onChange={(e) => handleChange('preferredCuisines', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            placeholder="e.g., Italian, Mexican, Japanese"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>
      </section>

      {/* Disliked Ingredients */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Disliked Ingredients</h2>
          <button
            onClick={() => setShowDislikeModal(true)}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {dislikedIngredients && dislikedIngredients.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {dislikedIngredients.map(ing => (
              <span
                key={ing.id}
                className="flex items-center gap-1 px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm"
              >
                {ing.name}
                <button
                  onClick={() => removeDislikeMutation.mutate(ing.id)}
                  className="p-0.5 hover:bg-red-100 rounded-full"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No disliked ingredients. Recipes containing these will be ranked lower.</p>
        )}
      </section>

      {/* Liked Ingredients */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Liked Ingredients</h2>
          <button
            onClick={() => setShowLikeModal(true)}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {likedIngredients && likedIngredients.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {likedIngredients.map(ing => (
              <span
                key={ing.id}
                className="flex items-center gap-1 px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm"
              >
                <Heart className="w-3 h-3" />
                {ing.name}
                <button
                  onClick={() => removeLikeMutation.mutate(ing.id)}
                  className="p-0.5 hover:bg-green-100 rounded-full"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No liked ingredients yet. These will be prioritized in recommendations.</p>
        )}
      </section>

      {/* Recommendation Weights */}
      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Recommendation Priorities</h2>
        <p className="text-sm text-gray-500">
          Adjust how much each factor matters when suggesting recipes. Higher = more important.
        </p>

        <div className="space-y-3">
          {[
            { key: 'variety', label: 'Variety', desc: 'Prefer recipes you haven\'t made recently' },
            { key: 'expiration', label: 'Use Expiring', desc: 'Prioritize ingredients expiring soon' },
            { key: 'pantry', label: 'Pantry Match', desc: 'Prefer recipes using ingredients you have' },
            { key: 'budget', label: 'Budget', desc: 'Stay within your weekly budget' },
            { key: 'calorie', label: 'Calories', desc: 'Match your daily calorie target' },
            { key: 'time', label: 'Cooking Time', desc: 'Quick meals on weekdays, longer on weekends' },
            { key: 'rating', label: 'Past Ratings', desc: 'Prefer recipes you\'ve liked before' },
          ].map(({ key, label, desc }) => (
            <WeightSlider
              key={key}
              label={label}
              description={desc}
              value={(currentPrefs.priorityWeights as Record<string, number>)?.[key] ?? 0.15}
              onChange={(value) => {
                const weights = { ...(currentPrefs.priorityWeights || {}), [key]: value }
                handleChange('priorityWeights', weights as UserPreferences['priorityWeights'])
              }}
            />
          ))}
        </div>
      </section>

      {/* Add Dislike Modal */}
      {showDislikeModal && (
        <AddPreferenceModal mode="dislike" onClose={() => setShowDislikeModal(false)} />
      )}

      {/* Add Like Modal */}
      {showLikeModal && (
        <AddPreferenceModal mode="like" onClose={() => setShowLikeModal(false)} />
      )}
    </div>
  )
}

function WeightSlider({ label, description, value, onChange }: {
  label: string
  description: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <input
        type="range"
        min="0"
        max="0.5"
        step="0.05"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-32"
      />
      <span className="text-sm text-gray-600 w-8">{Math.round(value * 100)}%</span>
    </div>
  )
}

function AddPreferenceModal({ mode, onClose }: { mode: 'like' | 'dislike'; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: ingredientList } = useQuery({
    queryKey: ['ingredients', search],
    queryFn: () => ingredients.list({ search }),
    enabled: search.length > 0,
  })

  const addMutation = useMutation({
    mutationFn: mode === 'like' ? preferences.addLike : preferences.addDislike,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold">
            {mode === 'like' ? 'Add Liked Ingredient' : 'Add Disliked Ingredient'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ingredients..."
            autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />

          {ingredientList && ingredientList.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
              {ingredientList.map(ing => (
                <button
                  key={ing.id}
                  onClick={() => addMutation.mutate(ing.id)}
                  disabled={addMutation.isPending}
                  className="w-full p-2 text-left hover:bg-gray-50 disabled:opacity-50"
                >
                  <p className="font-medium">{ing.name}</p>
                  <p className="text-xs text-gray-500">{ing.category}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
