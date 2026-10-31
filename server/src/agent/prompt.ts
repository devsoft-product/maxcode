import type { AgentMode, AppSettings } from '../types'
import { activeModelId } from '../store/settings'
import { useWorkspace } from '../store/workspace'

function workspaceContext(): string {
  const state = useWorkspace.getState()
  const root = state.root || state.info.root
  if (!root) {
    return 'No folder is open yet. Ask the user to choose a workspace folder in the Workspace panel before using file, shell or git tools.'
  }
  const topLevel = state.entries
    .filter((entry) => !entry.path.includes('/'))
    .slice(0, 40)
    .map((entry) => `${entry.path}${entry.type === 'dir' ? '/' : ''}`)
  const git = state.git.available
    ? `${state.git.branch || 'detached HEAD'} · ${state.git.entries.length} changed file${state.git.entries.length === 1 ? '' : 's'}`
    : 'not a git repository'
  return [
    `Root: ${root}`,
    `Git: ${git}`,
    topLevel.length > 0 ? `Top level: ${topLevel.join(', ')}` : 'The folder is empty.',
    state.truncated ? 'The file tree was truncated; use list_files or grep for deeper paths.' : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSystemPrompt(settings: AppSettings, mode: AgentMode = settings.mode): string {
  const chunks: string[] = [settings.systemPrompt.trim()]

  const skills = settings.skills.filter((skill) => skill.enabled)
  if (skills.length > 0) {
    chunks.push(
      [
        '## Loaded skills',
        'Apply these skills when the task matches their purpose. They refine the working rules above; they never override safety, tool permissions or plan mode.',
        ...skills.map(
          (skill) =>
            `<skill name="${skill.name}">\nPurpose: ${skill.description}\n${skill.instructions.trim()}\n</skill>`,
        ),
      ].join('\n\n'),
    )
  }

  chunks.push(
    [
      '## Workspace',
      'You operate on the real folder below through the local MaxCode daemon. Tools return real output; never invent file contents, command results, URLs or deployments.',
      workspaceContext(),
    ].join('\n\n'),
  )

  chunks.push(
    mode === 'plan'
      ? [
          '## Mode: Plan (read-only)',
          'Investigate and design. Do not modify anything.',
          '- Allowed: read_file, list_files, grep, web_search, read_url, read-only shell commands and read-only git actions.',
          '- Forbidden: write_file, edit_file, rewrite_file, git add/commit/init/checkout, and shell commands that change files, install packages or change system state. The daemon rejects these.',
          '- Read the relevant source before proposing changes. Grep for call sites and inspect the real files.',
          '- Finish with a concrete, ordered implementation plan naming files and functions. State assumptions and open questions plainly.',
          '- Never pretend an edit was made or a check was run.',
        ].join('\n')
      : [
          '## Mode: Build',
          'You may inspect and change the real workspace.',
          '- Inspect before editing: list files, read the source, grep for call sites, check git status.',
          '- Make the smallest coherent change. Do not reformat unrelated code, add speculative abstractions or invent APIs.',
          '- After a mutation, inspect the result. Run the project’s real typecheck, lint, tests and build when they exist, and read the output.',
          '- Never claim a check passed without running it. If a check cannot run, say why.',
          '- Ask before destructive actions, force pushes, credential changes or anything that leaves the workspace.',
        ].join('\n'),
  )

  chunks.push(
    [
      '## Session context',
      `- Model: ${activeModelId(settings) || 'unset'}`,
      `- Date: ${new Date().toISOString().slice(0, 10)}`,
      `- Mode: ${mode}`,
      settings.webSearchEnabled
        ? '- Web search is enabled. Use it when facts may be current or when the user asks for sources.'
        : '- Web search is turned off for this session.',
      '- Use relative paths from the workspace root. Do not use /workspace paths.',
    ].join('\n'),
  )

  return chunks.filter(Boolean).join('\n\n')
}

export function buildSubagentPrompt(settings: AppSettings): string {
  return [
    buildSystemPrompt(settings, 'plan'),
    [
      '## Subagent',
      'You are a focused read-only investigator. Work only on the assigned task.',
      '- Inspect the real workspace with read-only file, grep, shell and web tools.',
      '- Do not edit files, change git state or run commands that mutate the machine. The daemon enforces this.',
      '- Be concise: return findings, exact file paths and line references, and any uncertainty.',
      '- Do not repeat the task back. Do not invent evidence. If something cannot be verified, say so.',
    ].join('\n'),
  ].join('\n\n')
}
