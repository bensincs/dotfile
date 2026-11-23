# Fluent 2 design reference

## The visual target

Fluent feels calm, precise, useful, and familiar. Information is easy to scan;
controls have clear affordances; navigation stays predictable. The design system
supports different product personalities without sacrificing a consistent grammar.

A successful transformation changes the whole visual system, not just colors:

| Layer | Fluent treatment | Avoid |
| --- | --- | --- |
| Composition | Clear task hierarchy, aligned regions, purposeful whitespace | A grid of equally loud cards |
| Surfaces | Neutral canvas, distinct content surfaces, restrained elevation | Glass panels and shadows everywhere |
| Typography | Fluent type ramp and readable native fallback fonts | Giant display headings on routine forms |
| Color | Semantic roles, restrained brand accents, deliberate state colors | Painting every surface blue |
| Geometry | Consistent control radii, subtle strokes, aligned edges | Pills for every control; arbitrary rounding |
| Interaction | Recognizable controls, visible focus, complete states | Clickable-looking decoration and dead buttons |
| Detail | Fluent system icons, concise labels, stable alignment | Emoji icons and mismatched icon families |

Do not copy the Fluent documentation site's marketing layout into a productivity
app. Use the component examples and design principles appropriate to the task.

## Typography

Prefer Fluent's typography components or `typographyStyles` presets. Keep semantic
HTML headings independent of their visual size: a title styled as `Title3` still
needs an appropriate heading element, not merely a bold span.

Core **web** ramp:

| Role | Size / line height | Typical use |
| --- | --- | --- |
| Caption 1 | 12 / 16 px | Supporting metadata, captions |
| Body 1 | 14 / 20 px | Body copy, labels, routine controls |
| Subtitle 2 | 16 / 22 px, semibold | Small section headings |
| Subtitle 1 | 20 / 26 px, semibold | Prominent section headings |
| Title 3 | 24 / 32 px, semibold | Page or panel titles |
| Title 2 | 28 / 36 px, semibold | Larger page titles |
| Title 1 | 32 / 40 px, semibold | High-level titles where warranted |
| Large title | 40 / 52 px, semibold | Spacious, high-level compositions |
| Display | 68 / 92 px, semibold | Exceptional promotional moments |

Use a small, deliberate subset. Most productivity screens need body, metadata,
section headings, and one page title—not the entire ramp. Long prose may need a
larger body role. Do not shrink essential text to make a dense layout fit.

Use Fluent's `fontFamilyBase` on web. Segoe UI is Microsoft's signature typeface,
but native system fallbacks on macOS, iOS, Android, and Linux are valid. Do not
assume Segoe is installed, download proprietary font files, or redistribute fonts
without an appropriate license. Native platform type ramps differ from web.

## Spacing, alignment, density

Fluent uses a 4-unit base grid, with 2/6/10-unit optical adjustments when needed.
The web library exposes directional spacing aliases:

| Suffix | Value | Example |
| --- | --- | --- |
| XXS | 2 px | Optical separation |
| XS | 4 px | Closely related details |
| SNudge | 6 px | Icon optical alignment |
| S | 8 px | Related controls and icon/text gaps |
| MNudge | 10 px | Optical adjustment |
| M | 12 px | Compact group padding |
| L | 16 px | Standard group spacing |
| XL | 20 px | Larger separation |
| XXL | 24 px | Section padding/gaps |
| XXXL | 32 px | Major section separation |

For example, `spacingHorizontalL` and `spacingVerticalL` are both 16 px. Prefer
aliases over repeating literals. The broader design ramp also contains larger
values; do not invent unsupported token names for them.

Practical composition defaults, not mandatory Microsoft dimensions:

- Use 16–32 px page insets, adjusted to viewport and content density.
- Keep related controls closer than unrelated sections.
- Align page titles, toolbars, field labels, and primary content edges.
- Keep a consistent row height and control-size family within a task region.
- Use compact sizes for pointer-heavy data work; increase hit areas for touch.
- Aim for at least 44×44 CSS px touch targets on web/iOS and 48×48 dp on Android.
  The hit area can be larger than its icon. Do not simply shrink desktop controls
  onto a phone or claim these are universal default Fluent control dimensions.
- Use logical properties (`padding-inline`, `margin-block`, etc.) for localization.

## Color roles and themes

Use semantic aliases; select colors by role, not by their current appearance.

| Purpose | React v9 token examples |
| --- | --- |
| Content surface / supporting canvas | `colorNeutralBackground1`, `colorNeutralBackground2` |
| Primary / secondary text | `colorNeutralForeground1`, `colorNeutralForeground2` |
| Primary action fill | `colorBrandBackground` |
| Primary action states | `colorBrandBackgroundHover`, `colorBrandBackgroundPressed` |
| Text on primary fill | `colorNeutralForegroundOnBrand` |
| Brand text/link | `colorBrandForeground1` |
| Subtle surface stroke | `colorNeutralStroke1` |
| Accessible control stroke | `colorNeutralStrokeAccessible` |
| Keyboard focus | `colorStrokeFocus1`, `colorStrokeFocus2` |

Prefer built-in control state styling. For custom compositions, use the matching
hover/pressed/selected/disabled tokens rather than lowering the entire element's
opacity or inventing a darkened hex value. A subtle surface border is not necessarily
sufficient contrast for a custom input boundary.

- Default neutral web theme: `webLightTheme` / `webDarkTheme`.
- Default light web brand blue is currently `#0f6cbd`; this is orientation, not a
  license to hardcode it into every component.
- Preserve an existing product brand with a generated Fluent theme/ramp.
- Use danger/warning/success colors only for their meanings, paired with text or
  icons. Chart category colors and status colors serve different purposes.
- Use a real dark theme, not a CSS invert filter or a light theme with a dark body.
- Test text on actual surface pairs. Fluent components do not automatically make
  arbitrary custom combinations or branded overrides accessible.

## Shape, strokes, elevation

Common current web radius tokens: `borderRadiusSmall` (2 px),
`borderRadiusMedium` (4 px), `borderRadiusLarge` (6 px), and
`borderRadiusXLarge` (8 px). Larger tokens exist; use them deliberately for the
appropriate component. `borderRadiusCircular` is for genuinely circular/pill forms,
not every panel and button. Let official components own their default geometry.

Use subtle strokes or surface contrast to separate ordinary content. Use shadows
to communicate actual layering. The Fluent shadow ramp is `shadow2`, `shadow4`,
`shadow8`, `shadow16`, `shadow28`, `shadow64`; prefer component defaults and the
theme's values over homemade shadows. Do not assign arbitrary z-index values that
put tooltips behind dialogs or menus under sticky headers.

Acrylic/Mica are platform-specific materials, not a requirement to put
`backdrop-filter: blur(...)` on a web page. Avoid heavy gradients, glowing borders,
excessive blur, and exaggerated depth unless the brief genuinely calls for them.

## Component and pattern mapping

Verify availability in the chosen Fluent package/version before importing.

| Existing pattern | Fluent direction |
| --- | --- |
| Primary / secondary / quiet actions | `Button` appearance and size variants |
| Form field | `Field` plus `Input`, `Textarea`, or suitable control |
| Simple / searchable choice | `Select` / `Dropdown` / `Combobox`, based on behavior |
| Boolean preference / selection | `Switch` for immediate settings; `Checkbox` for selection |
| Mutually exclusive choices | `RadioGroup` with `Radio` |
| Same-context views | `TabList` / `Tab` with associated panels |
| Page navigation | Supported Fluent navigation components and real route links |
| Command group | `Toolbar`, with appropriate action grouping |
| Action menu | `Menu` composition, not a select disguised as an action menu |
| Static tabular information | `Table` with proper headers |
| Interactive sortable/selectable grid | `DataGrid` when its interaction model is needed |
| Content group | `Card` when a surface boundary is useful; otherwise a section |
| Blocking decision | `Dialog` composition |
| Contextual detail | Appropriate `Drawer` or `Popover`, not always a modal |
| Inline status / transient feedback | `MessageBar` / toast APIs as appropriate |
| Existing loading state | `Spinner`, `Skeleton`, or `ProgressBar` as appropriate |
| People / status | `Avatar`, `Badge`, semantic text |

A migration must preserve state shape and event contracts. A prettier select that
loses multi-select or keyboard search is a regression. A table should not become an
ARIA grid solely because `DataGrid` looks convenient.

## Interaction, accessibility, and content

- Give each task region a clear primary action; use neutral/quiet secondary actions.
- Use short, specific verb labels: “Save changes”, not “Submit” where intent is known.
- Keep persistent field labels. Placeholders are not labels.
- Keep errors next to the relevant field and explain how to resolve them.
- Use Fluent system icons (`@fluentui/react-icons` for React); regular is the usual
  action treatment, filled can indicate selection. Give icon-only buttons accessible
  names. A tooltip is supplementary, not the sole labeling strategy.
- Keep focus visible and unobscured. Preserve tab order, Escape dismissal, modal
  containment, and focus restoration to the trigger.
- Use existing disclosure patterns for narrow screens. Do not hide essential
  actions without an accessible alternative or convert navigation links into tabs.
- Honor reduced motion and forced-colors/high-contrast preferences. Motion should
  explain a change, not delay the task. Avoid `transition: all`.
- Preserve localization, long labels, and dynamic content. Check reflow at 320 CSS
  px and text zoom at 200%; meaningful two-dimensional data may need a contained
  horizontal scroller, not horizontal overflow on the entire page.
- Target WCAG 2.2 AA: normal text 4.5:1, large text 3:1, meaningful non-text controls
  3:1 where required. Automated checks and screenshots do not prove full compliance.

## Sources

- [Start developing](https://fluent2.microsoft.design/get-started/develop)
- [Tokens](https://fluent2.microsoft.design/design-tokens)
- [Typography](https://fluent2.microsoft.design/typography)
- [Layout](https://fluent2.microsoft.design/layout)
- [Color](https://fluent2.microsoft.design/color)
- [Elevation](https://fluent2.microsoft.design/elevation)
- [Iconography](https://fluent2.microsoft.design/iconography)
- [Motion](https://fluent2.microsoft.design/motion)
- [Accessibility](https://fluent2.microsoft.design/accessibility)
- [Current token source](https://github.com/microsoft/fluentui/tree/master/packages/tokens/src)
