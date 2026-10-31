import type { Skill } from '../types'

export const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'skill-debugger',
    name: 'Systematic debugger',
    description: 'Reproduce, isolate and verify a bug before fixing it.',
    enabled: false,
    builtIn: true,
    instructions: `When debugging:
1. Reproduce the failure and capture the exact output.
2. Read the relevant source before changing anything.
3. Form one hypothesis at a time. Prove or disprove it with a command or a focused test.
4. Fix the root cause, not the symptom. Add a regression test when a test setup exists.
5. Re-run the reproduction and report the real result. Never claim a fix without evidence.`,
  },
  {
    id: 'skill-reviewer',
    name: 'Code reviewer',
    description: 'Review changes for correctness, regressions and clarity.',
    enabled: false,
    builtIn: true,
    instructions: `Act as a rigorous senior reviewer. Inspect the whole change, then report only issues that matter:
- correctness and edge cases
- security and data loss risks
- broken public behavior or missing migrations
- needless abstraction, duplicated logic and swallowed errors
Order findings by severity and cite the file and line. Do not rewrite code unless asked. If you find nothing substantive, say so plainly.`,
  },
  {
    id: 'skill-brainstorm',
    name: 'Brainstorm',
    description: 'Explore the problem space before committing to a design.',
    enabled: false,
    builtIn: true,
    instructions: `When brainstorming:
1. Restate the real problem and the constraints that cannot move. Ask one short question only if a decision genuinely blocks progress.
2. Produce several genuinely different directions, not variations of the first idea. Name the trade-off each one makes.
3. Look for the smallest version that proves the idea. Prefer reversible steps.
4. Stress-test the leading option against failure modes, cost, maintenance and the user's actual workflow.
5. Finish with a recommendation, the assumptions behind it, and what would change your mind.
Do not start editing until the direction is chosen.`,
  },
  {
    id: 'skill-frontend',
    name: 'Frontend craftsman',
    description: 'Build interfaces with considered typography, spacing and states.',
    enabled: false,
    builtIn: true,
    instructions: `For interface work:
- Establish a small token system: base palette, one accent, type scale, spacing rhythm.
- Prefer one distinctive, purposeful moment over scattered decoration.
- Design empty, loading, error, disabled and mobile states, not just the happy path.
- Keep contrast accessible, focus rings visible, and respect reduced motion.
- Use real copy that names things by what people understand. No filler labels.`,
  },
]

export const STARTER_SKILL = `# Skill name

Describe what this skill is for in one sentence.

## Instructions

- What the agent should do
- Constraints it must respect
- How to verify the result
`
