import type { Effort, ModelInfo, ReasoningOption } from '../types'
import { EFFORT_ORDER } from '../data/providers'

export function effortValues(model?: ModelInfo | null): Effort[] {
  const option = model?.reasoningOptions.find(
    (entry): entry is Extract<ReasoningOption, { type: 'effort' }> => entry.type === 'effort',
  )
  return option?.values ?? []
}

export function budgetOption(
  model?: ModelInfo | null,
): Extract<ReasoningOption, { type: 'budget_tokens' }> | undefined {
  return model?.reasoningOptions.find(
    (entry): entry is Extract<ReasoningOption, { type: 'budget_tokens' }> =>
      entry.type === 'budget_tokens',
  )
}

export function hasBudget(model?: ModelInfo | null) {
  return Boolean(budgetOption(model))
}

export function hasToggle(model?: ModelInfo | null) {
  return Boolean(model?.reasoningOptions.some((entry) => entry.type === 'toggle'))
}

/** Whether the effort control applies: the live model advertises effort or a budget. */
export function supportsReasoningControl(model?: ModelInfo | null) {
  return effortValues(model).length > 0 || hasBudget(model)
}

/** Whether the model can think at all, even when the provider controls the switch. */
export function supportsReasoning(model?: ModelInfo | null) {
  return supportsReasoningControl(model) || hasToggle(model)
}

export function defaultEffort(model?: ModelInfo | null): Effort {
  const values = effortValues(model)
  if (values.length === 0) return 'medium'
  for (const candidate of ['medium', 'high', 'low'] as Effort[]) {
    if (values.includes(candidate)) return candidate
  }
  return values[0]
}

export function normalizeEffort(effort: Effort, model?: ModelInfo | null): Effort {
  const values = effortValues(model)
  if (values.length === 0) return effort
  if (values.includes(effort)) return effort
  return defaultEffort(model)
}

export function clampBudget(value: number, model?: ModelInfo | null) {
  const option = budgetOption(model)
  const min = Math.max(0, option?.min ?? 1024)
  const max = Math.max(min, option?.max ?? 32_768)
  return Math.max(min, Math.min(max, value))
}

const BUDGET_BY_EFFORT: Record<Effort, number> = {
  none: 1024,
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16_384,
  xhigh: 24_576,
  max: 32_768,
}

export function budgetForEffort(effort: Effort, model?: ModelInfo | null) {
  return clampBudget(BUDGET_BY_EFFORT[effort] ?? 8192, model)
}

export function effortOptions(model?: ModelInfo | null): Effort[] {
  const values = effortValues(model)
  return [...values].sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b))
}

export function reasoningSummary(model?: ModelInfo | null): string {
  if (!model) return 'Choose a model to see live reasoning controls.'
  const values = effortValues(model)
  if (values.length > 0) return `Effort levels from this model: ${values.join(', ')}.`
  if (hasBudget(model)) return 'This model accepts a thinking token budget, derived from the effort level.'
  if (hasToggle(model)) return 'This model controls reasoning itself; no effort value is sent.'
  return 'This model advertises no reasoning controls, so effort does not apply.'
}
