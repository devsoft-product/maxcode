import type { AdapterRequest, AdapterResult } from './adapters/shared'
import { streamAnthropic } from './adapters/anthropic'
import { streamGemini } from './adapters/gemini'
import { streamOpenAI } from './adapters/openai'
import { streamOpenAIResponses } from './adapters/openai-responses'
import { apiKindFor } from '../store/models'

export function streamModel(request: AdapterRequest): Promise<AdapterResult> {
  const kind = apiKindFor(request.settings.provider, request.settings.model, request.model)
  switch (kind) {
    case 'anthropic':
      return streamAnthropic(request)
    case 'gemini':
      return streamGemini(request)
    case 'openai-responses':
      return streamOpenAIResponses(request)
    default:
      return streamOpenAI(request)
  }
}
