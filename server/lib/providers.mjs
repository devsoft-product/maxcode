import { HttpError } from './http.mjs'
import {
  loadModelsCache,
  loadSecretsSafe,
  providerKey,
  saveModelsCache,
} from './store.mjs'

export const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    format: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    name: 'Anthropic',
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  google: {
    name: 'Google',
    format: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  opencode: {
    name: 'OpenCode',
    format: 'opencode',
    baseUrl: 'https://opencode.ai/inference/v1',
    listUrl: 'https://opencode.ai/inference/v1/models',
    bases: {
      'openai-chat': 'https://opencode.ai/inference/openai/v1',
      'openai-responses': 'https://opencode.ai/inference/openai/v1',
      anthropic: 'https://opencode.ai/inference/anthropic/v1',
      gemini: 'https://opencode.ai/inference/google/v1beta',
    },
  },
  deepseek: { name: 'DeepSeek', format: 'openai', baseUrl: 'https://api.deepseek.com' },
  openrouter: {
    name: 'OpenRouter',
    format: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  groq: { name: 'Groq', format: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  mistral: { name: 'Mistral', format: 'openai', baseUrl: 'https://api.mistral.ai/v1' },
  xai: { name: 'xAI', format: 'openai', baseUrl: 'https://api.x.ai/v1' },
  together: {
    name: 'Together AI',
    format: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
  },
  ollama: {
    name: 'Ollama',
    format: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    keyless: true,
  },
  custom: { name: 'Custom endpoint', format: 'openai', baseUrl: '', keyless: true },
}

const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'default'])

// Obvious provider/key mismatches are caught before they produce a confusing 401.
// Only stable, well-known prefixes are listed; providers with ambiguous formats are not checked.
export const KEY_FORMATS = {
  openrouter: { prefix: 'sk-or-', label: 'OpenRouter' },
  anthropic: { prefix: 'sk-ant-', label: 'Anthropic' },
  google: { prefix: 'AIza', label: 'Google' },
  groq: { prefix: 'gsk_', label: 'Groq' },
  xai: { prefix: 'xai-', label: 'xAI' },
}

export function validateKeyFormat(providerId, apiKey) {
  const clean = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!clean) return null

  for (const [otherId, format] of Object.entries(KEY_FORMATS)) {
    if (otherId !== providerId && clean.startsWith(format.prefix)) {
      return `This API key starts with "${format.prefix}", which belongs to ${format.label}. Please configure it under ${format.label} in Settings → Models.`
    }
  }

  const expected = KEY_FORMATS[providerId]
  if (expected && !clean.startsWith(expected.prefix)) {
    let hint = ''
    if (providerId === 'openrouter' && clean.startsWith('sk-')) {
      hint = ' (OpenRouter keys start with "sk-or-v1-". The key you entered looks like a DeepSeek or OpenAI key)'
    }
    return `An API key for ${expected.label} must start with "${expected.prefix}".${hint}`
  }

  return null
}
const NON_CHAT =
  /(^|[/_-])(embedding|embeddings|embed|whisper|tts|dall-e|moderation|transcribe|realtime|sora|audio|image|rerank|ocr)([/_-]|$)/i
const OPENAI_CHAT = /^(gpt|o[1-9]|chatgpt|codex)/i
const CATALOG_TTL = 12 * 60 * 60 * 1000
const CATALOG_URL = 'https://models.dev/api.json'

function record(value) {
  return value && typeof value === 'object' ? value : {}
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function providerDef(providerId) {
  const def = PROVIDERS[providerId]
  if (!def) throw new HttpError(400, `Unknown provider: ${providerId}`, 'unknown_provider')
  return def
}

export function isKnownProvider(providerId) {
  return Boolean(PROVIDERS[providerId])
}

function trimCatalog(raw) {
  const providers = {}
  for (const [providerId, value] of Object.entries(raw ?? {})) {
    const models = {}
    for (const [modelId, modelValue] of Object.entries(record(record(value).models))) {
      const model = record(modelValue)
      models[modelId] = {
        id: modelId,
        name: text(model.name) || modelId,
        family: text(model.family),
        reasoning: model.reasoning === true,
        reasoning_options: Array.isArray(model.reasoning_options) ? model.reasoning_options : [],
        tool_call: model.tool_call === true,
        temperature: model.temperature !== false,
        modalities: record(model.modalities),
        limit: record(model.limit),
        provider: record(model.provider),
        canonical_model_id: text(model.canonical_model_id),
      }
    }
    if (Object.keys(models).length > 0) providers[providerId] = { models }
  }
  return { fetchedAt: Date.now(), providers }
}

export async function loadCatalog({ force = false } = {}) {
  const cached = await loadModelsCache()
  const fresh = cached && Date.now() - Number(cached.fetchedAt ?? 0) < CATALOG_TTL
  if (cached && fresh && !force) return { catalog: cached, stale: false, error: '' }
  try {
    const response = await fetch(CATALOG_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`models.dev returned ${response.status}.`)
    const raw = await response.json()
    const catalog = trimCatalog(raw)
    await saveModelsCache(catalog)
    return { catalog, stale: false, error: '' }
  } catch (error) {
    if (cached) {
      return {
        catalog: cached,
        stale: true,
        error: error instanceof Error ? error.message : 'models.dev is unavailable.',
      }
    }
    return {
      catalog: { fetchedAt: 0, providers: {} },
      stale: true,
      error: error instanceof Error ? error.message : 'models.dev is unavailable.',
    }
  }
}

function catalogModel(catalog, providerId, modelId) {
  return catalog.providers?.[providerId]?.models?.[modelId] ?? null
}

function normalizeReasoning(model) {
  const options = Array.isArray(model.reasoning_options) ? model.reasoning_options : []
  const result = []
  for (const option of options) {
    const type = text(record(option).type)
    if (type === 'effort') {
      const values = strings(record(option).values)
        .map((value) => value.toLowerCase())
        .filter((value) => EFFORTS.has(value))
      if (values.length > 0) result.push({ type: 'effort', values })
    } else if (type === 'toggle') {
      result.push({ type: 'toggle' })
    } else if (type === 'budget_tokens') {
      result.push({
        type: 'budget_tokens',
        ...(number(record(option).min) !== undefined ? { min: number(record(option).min) } : {}),
        ...(number(record(option).max) !== undefined ? { max: number(record(option).max) } : {}),
      })
    }
  }
  return result
}

function opencodeKindFromId(modelId, catalogEntry) {
  const api = text(catalogEntry?.provider?.api)
  if (api.includes('/anthropic/')) return 'anthropic'
  if (api.includes('/google/')) return 'gemini'
  if (api.includes('/openai/')) {
    const family = `${text(catalogEntry?.family)} ${text(catalogEntry?.canonical_model_id)} ${modelId}`.toLowerCase()
    if (/\b(gpt|grok|muse|codex)\b/.test(family)) return 'openai-responses'
    return 'openai-chat'
  }
  const id = modelId.toLowerCase()
  if (/gemini/.test(id)) return 'gemini'
  if (/claude/.test(id) || /qwen.*(flash|plus)/.test(id)) return 'anthropic'
  if (/gpt|grok|muse|codex/.test(id)) return 'openai-responses'
  return 'openai-chat'
}

function modelInfo({ providerId, id, name, context, maxOutput, vision, catalogEntry, fallbackKind }) {
  const catalogDef = catalogEntry ?? {}
  const modalities = record(catalogDef.modalities)
  const limit = record(catalogDef.limit)
  const reasoningOptions = normalizeReasoning(catalogDef)
  const apiKind =
    providerId === 'opencode'
      ? opencodeKindFromId(id, catalogDef)
      : providerDef(providerId).format === 'anthropic'
        ? 'anthropic'
        : providerDef(providerId).format === 'gemini'
          ? 'gemini'
          : fallbackKind ?? 'openai-chat'
  const free =
    providerId === 'opencode' &&
    (/(^|[-_/])free($|[-_/])/i.test(id) ||
      /big-pickle|systemone|^jev/i.test(id) ||
      /(^|[-_/])test($|[-_/])/i.test(id))
  return {
    id,
    name: name || text(catalogDef.name) || id.replace(/^models\//, ''),
    context: context ?? number(limit.context),
    maxOutput: number(limit.output),
    vision: Boolean(
      vision ||
        strings(modalities.input).includes('image') ||
        strings(modalities.input).includes('pdf'),
    ),
    reasoningOptions,
    toolCall: catalogDef.tool_call !== false,
    temperature: catalogDef.temperature !== false,
    family: text(catalogDef.family) || undefined,
    apiKind,
    free,
    canonicalId: text(catalogDef.canonical_model_id) || undefined,
    note:
      providerId === 'opencode' && free
        ? 'OpenCode free-tier models only work inside OpenCode. Add credits or use a paid model.'
        : undefined,
  }
}

function dedupe(models) {
  const seen = new Set()
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

function fromOpenAI(payload, providerId, catalog) {
  const entries = Array.isArray(record(payload).data) ? record(payload).data : []
  const models = []
  for (const raw of entries) {
    const item = record(raw)
    const id = text(item.id)
    if (!id) continue
    if (providerId === 'openai' && !OPENAI_CHAT.test(id)) continue
    if (NON_CHAT.test(id)) continue
    const architecture = record(item.architecture)
    const output = strings(architecture.output_modalities)
    if (output.length > 0 && !output.includes('text')) continue
    const supported = strings(item.supported_parameters)
    if (providerId === 'openrouter' && supported.length > 0 && !supported.includes('tools')) {
      continue
    }
    const entry = catalogModel(catalog, providerId, id)
    models.push(
      modelInfo({
        providerId,
        id,
        name: text(item.name) || text(entry?.name),
        context: number(item.context_length) ?? number(item.context_window),
        vision: strings(architecture.input_modalities).includes('image'),
        catalogEntry: entry,
      }),
    )
  }
  return dedupe(models)
}

function fromAnthropic(payload, providerId, catalog) {
  const entries = Array.isArray(record(payload).data) ? record(payload).data : []
  return dedupe(
    entries
      .map((raw) => {
        const item = record(raw)
        const id = text(item.id)
        if (!id) return null
        return modelInfo({
          providerId,
          id,
          name: text(item.display_name),
          context: number(item.context_window),
          catalogEntry: catalogModel(catalog, providerId, id),
        })
      })
      .filter(Boolean),
  )
}

function fromGemini(payload, providerId, catalog) {
  const entries = Array.isArray(record(payload).models) ? record(payload).models : []
  return dedupe(
    entries
      .map((raw) => {
        const item = record(raw)
        const id = text(item.name).replace(/^models\//, '')
        if (!id) return null
        const methods = strings(item.supportedGenerationMethods)
        if (methods.length > 0 && !methods.includes('generateContent')) return null
        return modelInfo({
          providerId,
          id,
          name: text(item.displayName),
          context: number(item.inputTokenLimit),
          maxOutput: number(item.outputTokenLimit),
          vision: true,
          catalogEntry: catalogModel(catalog, providerId, id),
        })
      })
      .filter(Boolean),
  )
}

function fromCatalog(providerId, catalog) {
  const entries = Object.values(catalog.providers?.[providerId]?.models ?? {})
  const models = []
  for (const raw of entries) {
    const entry = record(raw)
    const id = text(entry.id)
    if (!id) continue
    if (providerId === 'openai' && !OPENAI_CHAT.test(id)) continue
    if (NON_CHAT.test(id)) continue
    if (providerId === 'opencode' && /big-pickle|systemone|^jev/i.test(id)) continue
    models.push(modelInfo({ providerId, id, catalogEntry: entry }))
  }
  return dedupe(models)
}

export function filterUsable(providerId, models) {
  if (providerId !== 'opencode') return models
  return models.filter((model) => !model.free && !/big-pickle|systemone|^jev/i.test(model.id))
}

function baseUrlFor(providerId, settings) {
  const def = providerDef(providerId)
  const custom = text(settings?.providers?.[providerId]?.baseUrl)
  const base = (custom || def.baseUrl || '').replace(/\/+$/, '')
  if (!base) {
    throw new HttpError(
      400,
      providerId === 'custom'
        ? 'Set a base URL for the custom endpoint in Settings → Models.'
        : `No base URL is configured for ${def.name}.`,
      'missing_base_url',
    )
  }
  return base
}

async function authHeaders(providerId, { settings, key } = {}) {
  const def = providerDef(providerId)
  const headers = { 'Content-Type': 'application/json' }
  const apiKey = key ?? (await providerKey(providerId))
  if (providerId === 'opencode') {
    if (!apiKey) {
      throw new HttpError(
        400,
        'Add an OpenCode API key in Settings → Models. OpenCode free-tier models cannot be used outside OpenCode.',
        'missing_key',
      )
    }
    headers.Authorization = `Bearer ${apiKey}`
    return headers
  }
  if (providerId === 'custom' || providerId === 'ollama') {
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    return headers
  }
  if (def.format === 'anthropic') {
    if (!apiKey) throw new HttpError(400, 'Add an Anthropic API key in Settings → Models.', 'missing_key')
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    return headers
  }
  if (def.format === 'gemini') {
    if (!apiKey) throw new HttpError(400, 'Add a Google API key in Settings → Models.', 'missing_key')
    headers['x-goog-api-key'] = apiKey
    return headers
  }
  if (!apiKey) {
    throw new HttpError(400, `Add an API key for ${def.name} in Settings → Models.`, 'missing_key')
  }
  headers.Authorization = `Bearer ${apiKey}`
  if (providerId === 'openrouter') {
    if (!apiKey.startsWith('sk-or-')) {
      throw new HttpError(
        400,
        `The configured OpenRouter key does not match the OpenRouter key format (starts with "${apiKey.slice(0, 5)}…", but OpenRouter keys start with "sk-or-v1-"). If this is a DeepSeek key, please select the DeepSeek provider in Settings → Models.`,
        'invalid_key_format',
      )
    }
    headers['HTTP-Referer'] = 'http://127.0.0.1'
    headers['X-Title'] = 'MaxCode'
  }
  return headers
}

function listUrl(providerId, settings) {
  const def = providerDef(providerId)
  if (providerId === 'opencode') return def.listUrl
  const base = baseUrlFor(providerId, settings)
  if (def.format === 'anthropic') return `${base}/models?limit=1000`
  if (def.format === 'gemini') return `${base}/models?pageSize=1000`
  return `${base}/models`
}

async function listHeaders(providerId, settings) {
  const headers = await authHeaders(providerId, { settings })
  delete headers['Content-Type']
  return headers
}

async function responseDetail(response) {
  const raw = await response.text().catch(() => '')
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    const error = parsed.error
    if (typeof error === 'string') return error
    if (error && typeof error.message === 'string') return error.message
    if (typeof parsed.message === 'string') return parsed.message
  } catch {
    // Fall through to the raw text.
  }
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)
}

export async function listModels(providerId, settings) {
  const def = providerDef(providerId)
  const { catalog, stale, error: catalogError } = await loadCatalog()
  const url = listUrl(providerId, settings)
  try {
    const response = await fetch(url, {
      headers: await listHeaders(providerId, settings),
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) {
      const detail = await responseDetail(response)
      const friendly =
        response.status === 401
          ? `${def.name} rejected this API key (401).${detail ? ` ${detail}` : ''}`
          : response.status === 403
            ? `${def.name} refused to list models for this key (403).${detail ? ` ${detail}` : ''}`
            : `${def.name} returned HTTP ${response.status} while listing models.${detail ? ` ${detail}` : ''}`
      throw new HttpError(response.status, friendly, 'model_list_failed')
    }
    const payload = await response.json()
    const models =
      def.format === 'anthropic'
        ? fromAnthropic(payload, providerId, catalog)
        : def.format === 'gemini'
          ? fromGemini(payload, providerId, catalog)
          : fromOpenAI(payload, providerId, catalog)
    return {
      provider: providerId,
      models: filterUsable(providerId, models),
      source: 'live',
      fetchedAt: Date.now(),
      note:
        providerId === 'opencode'
          ? 'OpenCode free-tier models are not available outside OpenCode and are hidden here. Paid models work with an API key.'
          : '',
      catalogError: catalogError || (stale ? 'Using a cached model metadata snapshot.' : ''),
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 0
    const fallback = filterUsable(providerId, fromCatalog(providerId, catalog))
    if (fallback.length > 0 && (status === 0 || status === 404 || status >= 500)) {
      return {
        provider: providerId,
        models: fallback,
        source: 'catalog',
        fetchedAt: Date.now(),
        note: `The live model list could not be loaded. Showing the models.dev catalog instead. ${
          error instanceof Error ? error.message : ''
        }`.trim(),
        catalogError: catalogError || '',
      }
    }
    if (status === 0) {
      const base = baseUrlFor(providerId, settings)
      throw new HttpError(
        502,
        providerId === 'ollama'
          ? `Ollama is not running at ${base}. Start Ollama, then refresh, or choose another provider in Settings → Models.`
          : `${def.name} could not be reached at ${base}. Check that the server is running and the base URL is correct.`,
        'provider_unreachable',
      )
    }
    throw error
  }
}

export async function listModelStatus(providerId, settings) {
  const def = providerDef(providerId)
  const { secrets } = await loadSecretsSafe()
  const key = secrets.providers?.[providerId]?.apiKey ?? ''
  return {
    id: providerId,
    name: def.name,
    format: def.format,
    baseUrl: text(settings?.providers?.[providerId]?.baseUrl) || def.baseUrl,
    keyless: Boolean(def.keyless),
    configured:
      providerId === 'custom'
        ? Boolean(text(settings?.providers?.custom?.baseUrl))
        : Boolean(def.keyless || key),
    hint: key ? `••••${key.slice(-4)}` : '',
  }
}

export async function llmTarget(providerId, kind, model, settings) {
  const def = providerDef(providerId)
  const allowed =
    providerId === 'opencode'
      ? ['openai-chat', 'openai-responses', 'anthropic', 'gemini']
      : def.format === 'anthropic'
        ? ['anthropic']
        : def.format === 'gemini'
          ? ['gemini']
          : ['openai-chat', 'openai-responses']
  if (!allowed.includes(kind)) {
    throw new HttpError(400, `${def.name} does not support the ${kind} transport.`, 'bad_transport')
  }
  if (!text(model)) throw new HttpError(400, 'Choose a model before sending a message.', 'missing_model')
  const base =
    providerId === 'opencode'
      ? def.bases[kind]
      : baseUrlFor(providerId, settings)
  const headers = await authHeaders(providerId, { settings })
  headers.Accept = 'text/event-stream'
  let pathname
  if (kind === 'openai-chat') pathname = '/chat/completions'
  else if (kind === 'openai-responses') pathname = '/responses'
  else if (kind === 'anthropic') pathname = '/messages'
  else pathname = `/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
  return {
    url: `${base}${pathname}`,
    headers,
    provider: providerId,
    kind,
  }
}

export async function providerList(settings) {
  const result = []
  for (const id of Object.keys(PROVIDERS)) result.push(await listModelStatus(id, settings))
  return result
}

export async function searchKey() {
  const { secrets } = await loadSecretsSafe()
  return secrets.search?.apiKey ?? ''
}

export async function deploySecrets() {
  const { secrets } = await loadSecretsSafe()
  return secrets.deploy ?? {}
}
