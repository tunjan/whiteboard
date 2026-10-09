# UI styling contract

The design system lives in [`src/index.css`](../../index.css), in six numbered
sections:

1. **Fonts** — the operating system's UI face for chrome (what Firefox's own
   chrome uses), Inter for measured canvas text, Geist Mono for values and
   shortcuts, and Caveat for handwriting. Chrome loads no webfont.
2. **Primitives** — `:root` and `.dark`. The only place a literal colour or
   shadow value appears.
3. **Theme** — `@theme`. The public API: every name here becomes a Tailwind
   utility (`--color-surface` → `bg-surface`) _and_ a plain custom property, so
   raw CSS can use `var(--color-surface)`.
4. **Base** — resets, the global focus ring, touch hardening.
5. **Utilities** — `scrollbar-none`, coarse-pointer touch targets.
6. **Feature CSS** — tool-panel motion and the MathLive authoring surfaces.

## Rules

**Never introduce a colour outside section 2.** To retheme, change a primitive;
to add a semantic name, map it in section 3. A hex value in a `className`, or a
`var(--something)` that section 3 doesn't define, is a bug.

**Components carry structure and Tailwind utilities**, not bespoke CSS. There is
no `ui-*` recipe layer any more — it was deleted because nothing referenced it.
Shared visual decisions belong in a token, not a class.

**Focus is single-sourced.** `:focus-visible` in section 4 draws one outline for
the whole app. Do not add `focus-visible:ring-*` to a component, and do not add
`outline-none` to an interactive control — either one silently removes the only
focus indicator that control has. Popup _containers_ (dialog, popover, menu
positioners) and menu _items_ are the exceptions: they suppress the outline
because a background highlight already signals focus. Text fields (`input`,
`textarea`, `input-group`) are the third: they swap the outline for a blue
border plus `shadow-focus` halo.

## Token vocabulary

| group     | names                                                                                      |
| --------- | ------------------------------------------------------------------------------------------ |
| surfaces  | `canvas` `panel` `surface` `surface-hover` `popup-surface` `sunken` `inverse` `inverse-hover` `scrim` |
| lines     | `border` `border-strong` `border-subtle` `control-border` `focus`                          |
| ink       | `fg` `fg-secondary` `fg-muted` `fg-subtle` `fg-inverse`                                    |
| status    | `danger` `success` `warning` `info` `neutral` `inactive`, each as `-fg` `-bg` `-border`    |
| action    | `primary` `action` `action-hover` `action-active` `link` `focus` (one blue accent)         |
| radii     | `compact` 2 · `control` 4 · `overlay` 8 · `panel` 8 · `full` (the Proton scale)            |
| elevation | `control` `panel` `overlay`                                                                |
| motion    | `duration-instant` `-fast` `-base` `-slow` `-slower`; `ease-out-quart` `ease-in-out-quart` |

Status colours always carry the explicit `-fg` / `-bg` / `-border` suffix. The
bare `danger` / `success` aliases resolve, but `neutral` and `inactive` have no
bare form, so the suffixed spelling is the one that works across the whole set.

`scrim` is the modal backdrop; pick the opacity per overlay (`bg-scrim/35` for
dialogs, `bg-scrim/25` for the sheet).

**A control that is on wears the accent, not a black plate.** `tb-sel-bg` as
the wash and `tb-sel-fg` as the ink is what a pressed toggle, a selected tab, a
chosen tool and a lit menu key all say; a checkbox, a switch, a slider and a
progress bar fill with `action`. `inverse` is a surface role for genuinely
inverted chrome (the selection bar on the home screen), not a selected state.

**A popup and a dialog do not share a ground.** Menus, popovers, tooltips and
toasts stand on `popup-surface`; dialogs and cards stand on `surface`. They are
the same white in light theme and deliberately different in dark, which is how
Firefox separates a panel from in-content UI. Reaching for `bg-surface` on a
menu makes it read as a dialog the moment the theme flips.

Board chrome uses `Surface` systematically: `mode="docked" chrome` for
viewport-edge controls and `mode="floating" chrome` for the central tool rail.
Chrome controls are 32 px with 44 px coarse-pointer targets, 1.5 px icon
strokes, semantic active/status colours, and one global focus outline.

The shadcn aliases (`background`, `foreground`, `card`, `popover`,
`muted-foreground`, `destructive`, `input`, `ring`, `accent`,
`accent-foreground`) are also mapped, so components added by `shadcn add`
resolve without edits.

Two deliberate conventions keep shadcn components and board chrome aligned:

- **Text roles are always explicit.** Use `text-fg-secondary` and
  `text-fg-muted`; `secondary` remains a surface role for component variants.
- **`accent` is the neutral hover surface.** The single blue accent is exposed
  as `primary`, `action`, `link`, and `focus`, and is reserved for key actions
  and keyboard focus rather than ordinary tool selection.

Those aliases are a **landing pad, not a destination.** A component pasted in by
`shadcn add` renders correctly on day one, but before it ships its classes get
rewritten onto the names in the table above — `text-muted-foreground` →
`text-fg-muted`, `bg-popover` → `bg-popup-surface`, `text-destructive` →
`text-danger-fg`. Two spellings for one colour is how a folder ends up with
three vocabularies and no way to grep for anything.

**`dark:` is for what the tokens can't express.** Every colour token already
flips with the theme, so `dark:bg-…` almost always means the wrong token was
picked. The one standing exception in this folder is `avatar.tsx`, which flips
`mix-blend-darken` → `mix-blend-lighten`: a blend mode, not a colour.

## Checking your work

Every utility a component references must exist in the compiled stylesheet. A
name that isn't in the theme produces no CSS and fails silently, so this is not
something review catches by eye — run the class-diff check:

```bash
cd client && npm run build && python3 scripts/class-diff.py
```

`UNRESOLVED: 0` and `GUIDELINE VIOLATIONS: 0` is the passing state.

The script checks two different things. `UNRESOLVED` is the dead-class check:
names that generate no CSS. `GUIDELINE VIOLATIONS` enforces the rules on this
page, because the worst offenders are all _valid_ class names —

| rule                    | what it catches                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `focus-ring`            | `focus-visible:ring-*` competing with the global outline                                                               |
| `outline-suppressed`    | `outline-none` / `outline-hidden` outside the popup allowlist                                                          |
| `ring-offset-no-colour` | `ring-offset-2` with no offset colour — Tailwind's default is a literal `#fff`, so it paints a white halo in dark mode |
| `raw-palette`           | `bg-stone-*`, `bg-black`, `bg-white` instead of a semantic name                                                        |
| `dark-colour-fork`      | a `dark:` variant on a colour utility                                                                                  |

Violations are fatal inside `src/components/ui/` and reported-only elsewhere,
so the gate can stay green while the rest of the app catches up.

**One trap worth knowing:** Tailwind builds `duration-*` utilities from the
`--transition-duration-*` namespace, _not_ `--duration-*`. Defining only the
latter gives you a real CSS variable and no utility — `duration-base` silently
did nothing for a while. Both are declared now; add to both if you add a step.
