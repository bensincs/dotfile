---
name: fluent-ui
description: Redesign existing UIs to follow Microsoft's Fluent 2 design system using real Fluent UI components. Use for Microsoft styling, Fluent UI conversions, or making an app feel like Microsoft 365. Preserve functionality, exercise the result with Stagehand, and use Playwright screenshots plus visual inspection to verify the redesign.
---

# Fluent UI transformation

Turn the supplied interface into a cohesive, unmistakably Fluent experience.
Use real Fluent UI, not a blue recolor or a homemade approximation. Preserve the
product's purpose, content, and working interactions. Verify the rendered result.

## Non-negotiables

- **Components:** use official Fluent UI components wherever suitable. For new
  React integration, prefer Fluent UI React v9 (`@fluentui/react-components`).
- **Design:** use Fluent 2 hierarchy, semantic tokens, typography, spacing,
  iconography, surfaces, and interaction patterns together.
- **Behavior:** preserve routes, data, validation, permissions, keyboard behavior,
  analytics hooks, and accessible names. Do not silently remove features.
- **Browser checks:** use **Stagehand and Playwright**, not one instead of the other.
  Stagehand exercises tasks; Playwright makes deterministic assertions and captures
  screenshots. An AI action reporting success is not a test assertion.
- **Visual checks:** open and inspect the actual screenshots. Taking screenshots,
  reading the DOM, or passing tests alone does not establish visual correctness.
- **Honesty:** if a required tool, credential, app, or image viewer is unavailable,
  report the blocked check. Never claim the redesign is visually verified.

## Read the right references

Resolve these paths relative to this skill directory:

1. Read [design-system.md](references/design-system.md) for every transformation.
2. Read [implementation.md](references/implementation.md) before changing code.
3. Read [browser-verification.md](references/browser-verification.md) before the
   baseline and final browser passes. It includes version-aware Stagehand guidance,
   Playwright recipes, the screenshot matrix, and the visual acceptance gate.

Authoritative entry points:

- User-supplied Fluent portal: <https://developer.microsoft.com/en-us/fluentui#/>
- Fluent 2 design guidance: <https://fluent2.microsoft.design/>
- React v9 examples and APIs: <https://react.fluentui.dev/>

The older portal also contains v8 guidance. Match documentation to the installed
package and major version. Verify component exports and props before using them.
If online docs are unavailable, use bundled guidance and installed types; disclose
any API assumptions you could not verify.

## Workflow

### 1. Establish the target and constraints

Inspect only the supplied screen and the files needed to understand it: relevant
routes/components, theme, package manifest/lockfile, and browser-test setup.

Determine:

- Which screens and states are in scope? What are the user's main tasks?
- What framework, Fluent version, styling system, and theme mechanism exist?
- Which existing branding, density, localization, and responsive behaviors matter?
- How does the app start, and which local URL or preview is safe to use?
- Are Stagehand, Playwright, screenshots, and image inspection available?

If the target is unambiguous, proceed without a design questionnaire. Ask only for
missing information that blocks a correct implementation. A screenshot or public
URL without editable source is not permission to invent a new application; request
the project if implementation is expected.

Prefer existing browser tools/MCP integrations. Otherwise use the project's SDKs
and test runner. Do not install global tools or modify shared MCP configuration.
Use Yarn for new JavaScript/TypeScript tooling here unless the target repository
requires another manager. Keep browser tooling in development dependencies.

### 2. Capture the original experience

Before editing:

1. Run the existing app in a safe local/test environment.
2. Use Stagehand to understand and exercise a representative, non-destructive task.
3. Use Playwright to record the original route, viewport, state, and screenshots.
4. Identify the largest Fluent mismatches and behavioral invariants to preserve.

Use synthetic/test data. Do not send customer records, secrets, or credentials to a
model-backed browser tool without authorization. Never run destructive or billable
flows just to verify styling.

### 3. Choose a coherent design direction

Make a brief working design contract, not a separate documentation deliverable:

- Target screens and tasks.
- Official Fluent implementation/version and component replacements.
- Theme/brand choice, density, type hierarchy, surface hierarchy, and spacing rhythm.
- Responsive changes and representative states to capture.
- Checks and screenshot artifacts that will prove the result.

Default to neutral surfaces with restrained Fluent web-blue accents when the app
has no brand requirement. Preserve an intentional product brand through Fluent
semantic theming. Teams purple and Azure portal chrome are not universal Microsoft
styling. Do not force every product into a sidebar/dashboard layout.

### 4. Implement outside-in

Work in this order to avoid polishing components in an incoherent shell:

1. Theme/provider, semantic tokens, and page surface.
2. Layout, navigation, content width, and responsive behavior.
3. Type hierarchy, alignment, spacing, and density.
4. Fluent controls and composition: forms, actions, lists, tables, feedback,
   dialogs, and navigation as needed.
5. Icons, borders, elevation, focus, selected/hover/pressed states, and motion.
6. Existing loading, empty, error, disabled, and long-content states.

Use shared primitives for repeated patterns. Style through supported props, slots,
classes, and tokens; do not fight Fluent internals with global overrides. Keep
business logic intact. Preserve meaningful DOM semantics when swapping controls.
Do not add dummy metrics, stock copy, a theme switcher, or unrelated features.

### 5. Exercise, capture, inspect, correct

The verification loop is part of implementation, not an optional recommendation:

1. Run the relevant build/typecheck/tests using existing project commands.
2. Use Stagehand to repeat the preserved user task on the updated interface.
3. Use Playwright assertions to verify the resulting route, data/state, accessible
   controls, and important keyboard interactions.
4. Capture desktop and narrow-screen screenshots, plus relevant themes and states,
   following the matrix in `references/browser-verification.md`.
5. **Open every final screenshot with an image-capable tool.** Compare against the
   design contract and relevant official Fluent examples. Inspect a full-page
   image for composition and viewport/component crops for detail and overlays.
6. Fix concrete defects in code; rerun the affected flow, assertions, and captures.
   Inspect the new images, not stale files. Repeat until the acceptance gate passes.

Screenshots are evidence, not proof by themselves. Check focus order, semantics,
validation, and hidden states with browser assertions too. Do not approve a new
visual baseline merely because it matches the code you just wrote.

For native-only apps, use the appropriate official Fluent implementation, but
Stagehand/Playwright cannot validate arbitrary native windows. State that limitation
and obtain agreement on native tooling rather than pretending web checks cover it.

### 6. Report the result

Keep the final answer short:

- What changed and which Fluent library/version was used.
- Stagehand task and Playwright checks actually completed.
- Links/paths to before/after screenshots, including viewport/theme/state labels.
- Any failed or blocked checks and remaining visual defects.

Use `Verified` only when both browser passes ran, final screenshots were inspected,
and the acceptance gate passed. Otherwise use `Implemented; verification blocked`
or describe the actual failure. Do not claim accessibility certification.
