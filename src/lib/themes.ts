export type BuiltinThemeId = 'light' | 'dark' | 'system' | 'night-owl' | 'claude-code' | 'flame'

/** A built-in theme id, or a Safe plugin's `plugin-<plugin>:<theme>` id. */
export type ThemeId = BuiltinThemeId | (string & {})

export type ResolvedThemeId = Exclude<BuiltinThemeId, 'system'> | (string & {})

export interface ThemeMeta {
  id: string
  label: string
  /** Whether the `dark` class (and `dark:` Tailwind variants) applies. */
  dark: boolean
}

export const THEMES: ThemeMeta[] = [
  { id: 'light', label: 'Light', dark: false },
  { id: 'dark', label: 'Dark', dark: true },
  { id: 'night-owl', label: 'Night Owl', dark: true },
  { id: 'claude-code', label: 'Claude Code', dark: true },
  { id: 'flame', label: 'Flame', dark: true },
]

const SLUG = /^[a-z0-9][a-z0-9:_-]{0,79}$/
const registry = new Map<string, ThemeMeta>(THEMES.map((theme) => [theme.id, theme]))

/** Plugin-contributed themes register here so the app knows how to apply them. */
export function registerTheme(meta: ThemeMeta): void {
  registry.set(meta.id, meta)
}

export function unregisterTheme(id: string): void {
  if (THEMES.some((theme) => theme.id === id)) return
  registry.delete(id)
}

export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value)
}

export function resolveTheme(theme: ThemeId, prefersDark: boolean): string {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return isThemeId(theme) ? theme : 'light'
}

export function themeIsDark(theme: ThemeId, prefersDark: boolean): boolean {
  return registry.get(resolveTheme(theme, prefersDark))?.dark ?? false
}

export function normalizeTheme(value: unknown): ThemeId {
  if (value === 'system') return 'system'
  return isThemeId(value) ? value : 'system'
}
