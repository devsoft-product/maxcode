import { useEffect } from 'react'
import { create } from 'zustand'
import type { ApiKind, ModelInfo, ProviderId } from '../types'
import { PROVIDER_MAP } from '../data/providers'
import { fetchModels as fetchModelsFromDaemon } from '../lib/daemon'
import { activeModelId, hasCredentials, useSettings } from './settings'

const NO_MODELS: ModelInfo[] = []
const STALE_MS = 10 * 60 * 1000

interface ModelCatalogState {
  byProvider: Record<string, ModelInfo[]>
  loading: Record<string, boolean>
  errors: Record<string, string>
  notes: Record<string, string>
  source: Record<string, 'live' | 'catalog' | ''>
  fetchedAt: Record<string, number>
  fetchModels: (provider: ProviderId, force?: boolean) => Promise<ModelInfo[]>
}

export const useModelCatalog = create<ModelCatalogState>()((set, get) => ({
  byProvider: {},
  loading: {},
  errors: {},
  notes: {},
  source: {},
  fetchedAt: {},
  fetchModels: async (provider, force = false) => {
    if (get().loading[provider]) return get().byProvider[provider] ?? NO_MODELS
    if (!force) {
      const existing = get().byProvider[provider] ?? NO_MODELS
      const fetchedAt = get().fetchedAt[provider] ?? 0
      if (existing.length > 0 && Date.now() - fetchedAt < STALE_MS) return existing
    }
    set((state) => ({
      loading: { ...state.loading, [provider]: true },
      errors: { ...state.errors, [provider]: '' },
    }))
    try {
      const result = await fetchModelsFromDaemon(provider)
      set((state) => ({
        byProvider: { ...state.byProvider, [provider]: result.models },
        loading: { ...state.loading, [provider]: false },
        errors: { ...state.errors, [provider]: '' },
        notes: { ...state.notes, [provider]: result.note || result.catalogError || '' },
        source: { ...state.source, [provider]: result.source },
        fetchedAt: { ...state.fetchedAt, [provider]: result.fetchedAt || Date.now() },
      }))
      return result.models
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load models from this provider.'
      set((state) => ({
        loading: { ...state.loading, [provider]: false },
        errors: { ...state.errors, [provider]: message },
        source: { ...state.source, [provider]: '' },
      }))
      return get().byProvider[provider] ?? NO_MODELS
    }
  },
}))

export function useProviderModels(provider: ProviderId): ModelInfo[] {
  return useModelCatalog((state) => state.byProvider[provider]) ?? NO_MODELS
}

export function useActiveModel(): ModelInfo | null {
  const provider = useSettings((state) => state.provider)
  const model = useSettings((state) => state.model)
  return useModelCatalog((state) => {
    if (!model) return null
    return state.byProvider[provider]?.find((entry) => entry.id === model) ?? null
  })
}

export function findModel(provider: ProviderId, modelId: string): ModelInfo | null {
  if (!modelId) return null
  return useModelCatalog.getState().byProvider[provider]?.find((entry) => entry.id === modelId) ?? null
}

export function useModelSync() {
  const hydrated = useSettings((state) => state.hydrated)
  const provider = useSettings((state) => state.provider)

  useEffect(() => {
    if (!hydrated) return
    const settings = useSettings.getState()
    if (!hasCredentials(settings)) return
    const state = useModelCatalog.getState()
    const models = state.byProvider[provider] ?? NO_MODELS
    const fetchedAt = state.fetchedAt[provider] ?? 0
    if (models.length > 0 && Date.now() - fetchedAt < STALE_MS) return
    void state.fetchModels(provider)
  }, [hydrated, provider])
}

/**
 * The transport a model needs. Live model metadata wins; manual IDs fall back
 * to the provider family, with OpenCode inferred from the model id.
 */
export function apiKindFor(provider: ProviderId, modelId: string, model?: ModelInfo | null): ApiKind {
  if (model?.apiKind) return model.apiKind
  const preset = PROVIDER_MAP[provider]
  if (provider !== 'opencode') {
    if (preset?.format === 'anthropic') return 'anthropic'
    if (preset?.format === 'gemini') return 'gemini'
    return 'openai-chat'
  }
  const id = modelId.toLowerCase()
  if (/gemini|gemma/.test(id)) return 'gemini'
  if (/claude|qwen.*(flash|plus)/.test(id)) return 'anthropic'
  if (/gpt|grok|muse|codex/.test(id)) return 'openai-responses'
  return 'openai-chat'
}

export function activeModelInfo(): ModelInfo | null {
  const settings = useSettings.getState()
  return findModel(settings.provider, activeModelId(settings))
}

export { NO_MODELS }
