# Implement with real Fluent UI

## Choose the supported integration

| Target | Approach |
| --- | --- |
| React, no Fluent yet | Use current compatible stable React v9 components and Fluent system icons |
| React with Fluent v9 | Extend the existing provider/theme and composition patterns |
| React with v8 or Northstar | Do not assume v9 is a drop-in replacement; scope an explicit migration |
| Vue, Svelte, Angular, server-rendered HTML | Use official Fluent Web Components where compatible; preserve the framework |
| Existing wrapper around Fluent | Reuse the wrapper unless it prevents the requested result |
| Windows native | Use the applicable WinUI controls and Fluent resources |
| Apple / Android native | Check official Fluent platform libraries and current component coverage |
| Unsupported runtime or forbidden dependency | Explain the conflict; agree on an alternative rather than calling a CSS imitation Fluent UI |

Do not rewrite an entire app in React just to use Fluent. Do not silently migrate
legacy Fluent, add two component systems indiscriminately, or install preview
packages without agreement. Where gradual coexistence is needed, follow the
version-specific migration guidance and isolate theme/reset/focus boundaries.

## React v9

When adding new dependencies, use the repository's manager and lockfile. With Yarn:

```bash
yarn add @fluentui/react-components @fluentui/react-icons
```

Install compatible current stable versions; inspect the target manifest, peer
requirements, and existing lockfile first. Do not upgrade unrelated packages.

### Establish one theme boundary

Use the existing provider if present. Otherwise put `FluentProvider` near the app
root, outside the redesigned components, without disturbing routing or state.

Minimal integration pattern, not a replacement application:

```tsx
import type { ReactNode } from "react";
import {
  FluentProvider,
  makeStyles,
  tokens,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    minHeight: "100dvh",
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
  },
});

export function AppTheme({
  children,
  dark,
}: {
  children: ReactNode;
  dark: boolean;
}) {
  const styles = useStyles();
  return (
    <FluentProvider
      className={styles.root}
      theme={dark ? webDarkTheme : webLightTheme}
    >
      {children}
    </FluentProvider>
  );
}
```

Derive `dark` from the app's existing theme state. Do not add a theme toggle or
change persisted preferences just for the redesign. Avoid nested providers on
every card. Ensure portals and overlays inherit the intended theme.

For SSR frameworks, follow Fluent's current framework/Griffel renderer and style
rehydration guidance. Keep the provider at an appropriate client boundary. Do not
turn the entire application into a client component, disable SSR, or suppress
hydration errors to hide an incorrect integration.

### Tokens and composition

Use `tokens` and `typographyStyles` for custom layout around official controls.
For example, a section style can combine `typographyStyles.subtitle2`, semantic
text colors, and directional spacing aliases. Use supported component slots and
`className`/`mergeClasses` patterns when customization is needed.

- Prefer component `appearance`, `size`, and documented props before custom CSS.
- Keep provider/theme selection centralized and repeated patterns reusable.
- Use `createLightTheme` / `createDarkTheme` with a valid brand ramp when the brief
  requires custom branding. Follow the current theme designer/generation guidance;
  do not generate a “ramp” by assigning the same color to every shade.
- Check brand text, selected states, destructive actions, and primary-button text
  after theme overrides in both themes.
- Never target generated class names, rely on private component DOM, or use global
  `button`, `input`, `svg`, and `*` overrides that break Fluent internals.
- Existing CSS resets and Tailwind preflight may affect Fluent. Fix the smallest
  scoped conflict, not a global `!important` war.
- The presence of Fluent CSS variables depends on a correctly themed subtree.
  Do not paste `var(--colorBrandBackground)` into an unthemed page and assume it works.

### Preserve control contracts

Before swapping each control, map old behavior to Fluent's actual typed API:

- Controlled value/selection state and default state.
- Event argument shape; v9 callbacks often expose the value in a separate data
  argument rather than the old component's event shape.
- `id`, label association, error/help IDs, form name, and submitted value.
- `type="submit"` versus non-submitting button behavior.
- Links versus action buttons; route navigation must keep real link semantics.
- Multi-select, search, validation timing, sorting, selection, and virtualized rows.
- Focus management and portal behavior for menu, popover, drawer, and dialog.

Read installed component types or examples instead of guessing prop names.
Retain form-library registration/ref handling. Verify native form submission when
replacing controls with custom or web components.

## Other web frameworks

Use `@fluentui/web-components` and the matching version's official setup. Current
Fluent 2 Web Components use design-system registration and token-based theming;
older examples may use different registration and theme APIs. Read installed docs
and current official examples before writing setup code.

- Register required elements once at the supported application boundary.
- Configure the framework to recognize custom elements where necessary.
- Apply a real Fluent theme using the package's supported theme utilities.
- Preserve property versus attribute binding and custom-event handling.
- Verify form participation, labels, accessible names, shadow DOM, focus, and SSR.
- Confirm component coverage and release stability before proposing adoption.

Use the host framework for layout and state. If there is no suitable official
component for a niche visualization, compose a custom region with Fluent tokens
and accessible semantics; keep standard controls on real Fluent components.

## Browser-tool integration

Use existing Stagehand/Playwright tools if available. If project-local SDKs are
needed, keep them out of the production UI bundle. Follow the version-specific
setup in [browser-verification.md](browser-verification.md). Do not add automation
SDKs to runtime imports in the application just to run a design check.

Local verification is the default. Browserbase/cloud sessions are optional and
must not receive private development pages or data without authorization. Local
Stagehand still makes model calls; locality alone does not make page data private.

## Native boundary

Native Fluent libraries do not expose the React v9 API or web CSS token names.
Use native type, density, accessibility, and focus conventions. Stagehand and
Playwright inspect browser-rendered interfaces, not arbitrary UIKit/AppKit/WinUI
windows. For a native-only task, flag the requested browser-verification mismatch
before promising end-to-end verification.

## Sources

- [React v9 package](https://github.com/microsoft/fluentui/tree/master/packages/react-components/react-components)
- [React docs and migration guidance](https://react.fluentui.dev/)
- [Fluent platform setup](https://fluent2.microsoft.design/get-started/develop)
- [Web Components](https://github.com/microsoft/fluentui/tree/master/packages/web-components)
- [Fluent system icons](https://github.com/microsoft/fluentui-system-icons)
- [WinUI](https://learn.microsoft.com/en-us/windows/apps/winui/)
- [Fluent UI Apple](https://github.com/microsoft/fluentui-apple)
- [Fluent UI Android](https://github.com/microsoft/fluentui-android)
