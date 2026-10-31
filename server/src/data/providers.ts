import type { ProviderDef, ProviderId } from '../types'

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    format: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyHint: 'sk-…',
    note: 'GPT and Codex models. Requests are made by your local daemon, never by DevSoft.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyHint: 'sk-ant-…',
    note: 'Claude models, including extended thinking where the model supports it.',
  },
  {
    id: 'google',
    name: 'Google',
    format: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyHint: 'AIza…',
    note: 'Gemini models through the Generative Language API.',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    format: 'openai',
    baseUrl: 'https://opencode.ai/inference/v1',
    keyHint: 'OpenCode API key',
    note: 'OpenCode routes each model to its native API. Free-tier models only work inside OpenCode and are hidden.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    format: 'openai',
    baseUrl: 'https://api.deepseek.com',
    keyHint: 'sk-…',
    note: 'DeepSeek chat and reasoning models.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    format: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyHint: 'sk-or-…',
    note: 'One key for hundreds of models and providers.',
  },
  {
    id: 'groq',
    name: 'Groq',
    format: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyHint: 'gsk_…',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    format: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    keyHint: '…',
  },
  {
    id: 'xai',
    name: 'xAI',
    format: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyHint: 'xai-…',
  },
  {
    id: 'together',
    name: 'Together AI',
    format: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    keyHint: '…',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    format: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    keyless: true,
    keyHint: 'Not required',
    note: 'Runs on your machine. The daemon reaches it at localhost; no data leaves your computer.',
  },
  {
    id: 'custom',
    name: 'Custom endpoint',
    format: 'openai',
    baseUrl: '',
    keyHint: 'Optional',
    note: 'Any OpenAI-compatible endpoint or proxy you control.',
  },
]

export const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<
  ProviderId,
  ProviderDef
>

export function getProviderName(provider: ProviderId) {
  return PROVIDER_MAP[provider]?.name ?? provider
}

export const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export const EFFORT_LABELS: Record<
  (typeof EFFORT_ORDER)[number],
  { label: string; description: string }
> = {
  none: { label: 'None', description: 'Disable extra reasoning' },
  minimal: { label: 'Minimal', description: 'Very light reasoning' },
  low: { label: 'Low', description: 'Fast, lighter reasoning' },
  medium: { label: 'Medium', description: 'Balanced reasoning' },
  high: { label: 'High', description: 'Deeper reasoning, slower' },
  xhigh: { label: 'Extra high', description: 'Very deep reasoning' },
  max: { label: 'Max', description: 'Maximum effort the model allows' },
}

export function effortLabel(effort: string) {
  return EFFORT_LABELS[effort as keyof typeof EFFORT_LABELS]?.label ?? effort
}
