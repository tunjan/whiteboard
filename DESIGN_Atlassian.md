---
version: alpha
name: Atlassian Design System (ADS) — Light
description: >-
  Design tokens and usage rules modelled on the Atlassian Design System
  (atlassian.design), light theme, 2025–2026 visual refresh. Values are taken
  from the published @atlaskit/tokens 20.7.0 package (atlassian-light,
  atlassian-typography, atlassian-spacing, atlassian-shape, atlassian-motion).
  Token keys are the ADS token paths with dots replaced by hyphens and the
  leading "color." dropped (e.g. color.background.brand.bold → background-brand-bold).

colors:
  # ── Core roles (spec-recommended names) ─────────────────────────────
  primary: "#1868DB"                 # color.background.brand.bold (Blue700)
  primary-hovered: "#1558BC"         # color.background.brand.bold.hovered (Blue800)
  primary-pressed: "#144794"         # color.background.brand.bold.pressed (Blue850)
  secondary: "#505258"               # color.text.subtle (Neutral800)
  tertiary: "#964AC0"                # color.background.discovery.bold (Purple700)
  neutral: "#F8F8F8"                 # elevation.surface.sunken (Neutral100)
  surface: "#FFFFFF"                 # elevation.surface / raised / overlay (Neutral0)
  surface-hovered: "#F0F1F2"         # elevation.surface.hovered (Neutral200)
  surface-pressed: "#DDDEE1"         # elevation.surface.pressed (Neutral300)
  on-surface: "#292A2E"              # color.text (Neutral1000)
  error: "#C9372C"                   # color.background.danger.bold (Red700)

  # ── Text ────────────────────────────────────────────────────────────
  text: "#292A2E"                    # color.text
  text-subtle: "#505258"             # color.text.subtle
  text-subtlest: "#6B6E76"           # color.text.subtlest
  text-inverse: "#FFFFFF"            # color.text.inverse
  text-disabled: "#080F214A"         # color.text.disabled (Neutral400A)
  text-brand: "#1868DB"              # color.text.brand
  text-selected: "#1868DB"           # color.text.selected
  text-selected-hovered: "#1558BC"   # NOT an ADS token: Blue800, used on background-selected-hovered (ADS pairing is 3.92:1)
  text-danger: "#AE2E24"             # color.text.danger
  text-warning: "#9E4C00"            # color.text.warning
  text-warning-inverse: "#292A2E"    # color.text.warning.inverse
  text-success: "#4C6B1F"            # color.text.success
  text-discovery: "#803FA5"          # color.text.discovery
  text-information: "#1558BC"        # color.text.information
  link: "#1868DB"                    # color.link
  link-pressed: "#1558BC"            # color.link.pressed
  link-visited: "#803FA5"            # color.link.visited

  # ── Backgrounds: neutral & interaction ─────────────────────────────
  background-neutral: "#0515240F"            # Neutral200A
  background-neutral-hovered: "#0B120E24"    # Neutral300A
  background-neutral-pressed: "#080F214A"    # Neutral400A
  background-neutral-subtle: "#00000000"     # transparent
  background-neutral-subtle-hovered: "#0515240F"
  background-neutral-bold: "#292A2E"
  background-neutral-bold-hovered: "#3B3D42"
  background-disabled: "#0515240F"
  background-input: "#FFFFFF"
  background-input-hovered: "#F8F8F8"
  background-selected: "#E9F2FE"
  background-selected-hovered: "#CFE1FD"
  background-selected-bold: "#1868DB"
  background-brand-subtlest: "#E9F2FE"
  background-brand-boldest: "#1C2B42"

  # ── Backgrounds: semantic (subtle = message panels, bold = filled) ──
  background-danger: "#FFECEB"
  background-danger-bold: "#C9372C"
  background-danger-bold-hovered: "#AE2E24"
  background-warning: "#FFF5DB"
  background-warning-bold: "#FBC828"
  background-warning-bold-hovered: "#FCA700"
  background-success: "#EFFFD6"
  background-success-bold: "#5B7F24"
  background-discovery: "#F8EEFE"
  background-discovery-bold: "#964AC0"
  background-information: "#E9F2FE"
  background-information-bold: "#1868DB"
  background-information-subtler: "#CFE1FD"
  background-success-subtler: "#D3F1A7"
  background-danger-subtler: "#FFD5D2"
  background-warning-subtler: "#FCE4A6"
  background-discovery-subtler: "#EED7FC"

  # ── Borders & focus ────────────────────────────────────────────────
  border: "#0B120E24"                # color.border (Neutral300A)
  border-bold: "#7D818A"             # color.border.bold
  border-input: "#8C8F97"            # color.border.input
  border-focused: "#4688EC"          # color.border.focused (Blue500)
  border-selected: "#1868DB"
  border-danger: "#E2483D"
  border-warning: "#E06C00"
  border-success: "#6A9A23"
  border-information: "#357DE8"
  border-discovery: "#AF59E1"

  # ── Icons ──────────────────────────────────────────────────────────
  icon: "#292A2E"
  icon-subtle: "#505258"
  icon-danger: "#C9372C"
  icon-warning: "#E06C00"
  icon-success: "#6A9A23"
  icon-information: "#357DE8"
  icon-discovery: "#AF59E1"

  # ── Overlays ───────────────────────────────────────────────────────
  blanket: "#050C1F75"               # color.blanket (Neutral500A) — modal scrim
  skeleton: "#0515240F"              # color.skeleton

typography:
  heading-xxlarge:
    fontFamily: Atlassian Sans
    fontSize: 32px
    fontWeight: 653
    lineHeight: 36px
  heading-xlarge:
    fontFamily: Atlassian Sans
    fontSize: 28px
    fontWeight: 653
    lineHeight: 32px
  heading-large:
    fontFamily: Atlassian Sans
    fontSize: 24px
    fontWeight: 653
    lineHeight: 28px
  heading-medium:
    fontFamily: Atlassian Sans
    fontSize: 20px
    fontWeight: 653
    lineHeight: 24px
  heading-small:
    fontFamily: Atlassian Sans
    fontSize: 16px
    fontWeight: 653
    lineHeight: 20px
  heading-xsmall:
    fontFamily: Atlassian Sans
    fontSize: 14px
    fontWeight: 653
    lineHeight: 20px
  heading-xxsmall:
    fontFamily: Atlassian Sans
    fontSize: 12px
    fontWeight: 653
    lineHeight: 16px
  body-large:
    fontFamily: Atlassian Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body:
    fontFamily: Atlassian Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  body-medium-weight:
    fontFamily: Atlassian Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  body-small:
    fontFamily: Atlassian Sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  metric-large:
    fontFamily: Atlassian Sans
    fontSize: 28px
    fontWeight: 653
    lineHeight: 32px
  metric-medium:
    fontFamily: Atlassian Sans
    fontSize: 24px
    fontWeight: 653
    lineHeight: 28px
  metric-small:
    fontFamily: Atlassian Sans
    fontSize: 16px
    fontWeight: 653
    lineHeight: 20px
  code:
    fontFamily: Atlassian Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 20px
  label-lozenge:
    fontFamily: Atlassian Sans
    fontSize: 11px
    fontWeight: 653
    lineHeight: 16px

rounded:
  none: 0px
  xsmall: 2px      # radius.xsmall — tooltips, checkbox box
  small: 4px       # radius.small  — buttons, lozenges, badges
  medium: 6px      # radius.medium — text fields, selects, menus
  large: 8px       # radius.large  — cards, popups
  xlarge: 12px     # radius.xlarge — modals
  xxlarge: 16px    # radius.xxlarge — large containers
  full: 9999px     # radius.full — avatars, pills

spacing:
  base: 8px
  space-0: 0px
  space-025: 2px
  space-050: 4px
  space-075: 6px
  space-100: 8px
  space-150: 12px
  space-200: 16px
  space-250: 20px
  space-300: 24px
  space-400: 32px
  space-500: 40px
  space-600: 48px
  space-800: 64px
  space-1000: 80px
  space-negative-025: -2px
  space-negative-050: -4px
  space-negative-075: -6px
  space-negative-100: -8px
  space-negative-150: -12px
  space-negative-200: -16px
  space-negative-250: -20px
  space-negative-300: -24px
  space-negative-400: -32px
  border-width: 1px
  border-width-selected: 2px
  border-width-focused: 2px
  modal-width-small: 400px
  modal-width-medium: 600px
  modal-width-large: 800px
  modal-width-xlarge: 968px

components:
  # Buttons — height 32px (default) / 24px (compact); label font.body @ weight 500
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.body-medium-weight}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-150}"
    height: 32px
  button-primary-hovered:
    backgroundColor: "{colors.primary-hovered}"
    textColor: "{colors.text-inverse}"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.text-inverse}"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-subtle}"
    typography: "{typography.body-medium-weight}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-150}"
    height: 32px
  button-default-hovered:
    backgroundColor: "{colors.surface-hovered}"
    textColor: "{colors.text-subtle}"
  button-default-pressed:
    backgroundColor: "{colors.surface-pressed}"
    textColor: "{colors.text-subtle}"
  button-subtle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-subtle}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-150}"
    height: 32px
  button-subtle-hovered:
    backgroundColor: "{colors.surface-hovered}"
    textColor: "{colors.text-subtle}"
  button-danger:
    backgroundColor: "{colors.background-danger-bold}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.body-medium-weight}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-150}"
    height: 32px
  button-danger-hovered:
    backgroundColor: "{colors.background-danger-bold-hovered}"
    textColor: "{colors.text-inverse}"
  button-warning:
    backgroundColor: "{colors.background-warning-bold}"
    textColor: "{colors.text-warning-inverse}"
    typography: "{typography.body-medium-weight}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-150}"
    height: 32px
  button-warning-hovered:
    backgroundColor: "{colors.background-warning-bold-hovered}"
    textColor: "{colors.text-warning-inverse}"
  button-discovery:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-150}"
    height: 32px
  button-selected:
    backgroundColor: "{colors.background-selected}"
    textColor: "{colors.text-selected}"
    rounded: "{rounded.small}"
    height: 32px
  button-compact:
    height: 24px
    padding: "{spacing.space-075}"
    rounded: "{rounded.small}"
  button-disabled:
    backgroundColor: "{colors.background-disabled}"
    textColor: "{colors.text-disabled}"
  link:
    textColor: "{colors.link}"
    typography: "{typography.body}"
  link-pressed:
    textColor: "{colors.link-pressed}"
  link-visited:
    textColor: "{colors.link-visited}"

  # Text field / select / text area — 1px border.input, 2px border.focused ring on focus
  input-field:
    backgroundColor: "{colors.background-input}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.medium}"
    padding: "{spacing.space-075}"
  input-field-hovered:
    backgroundColor: "{colors.background-input-hovered}"
    textColor: "{colors.text}"
  input-field-placeholder:
    textColor: "{colors.text-subtlest}"
  input-field-border:
    backgroundColor: "{colors.border-input}"
    width: "{spacing.border-width}"
  input-field-focus-ring:
    backgroundColor: "{colors.border-focused}"
    width: "{spacing.border-width-focused}"
  input-field-error-border:
    backgroundColor: "{colors.border-danger}"
  field-label:
    textColor: "{colors.text-subtle}"
    typography: "{typography.body-small}"
  helper-text:
    textColor: "{colors.text-subtlest}"
    typography: "{typography.body-small}"
  error-message:
    textColor: "{colors.text-danger}"
    typography: "{typography.body-small}"

  # Checkbox & radio — 2px xsmall-rounded box; checked = primary fill
  checkbox:
    backgroundColor: "{colors.background-input}"
    rounded: "{rounded.xsmall}"
    size: 14px
  checkbox-border:
    backgroundColor: "{colors.border-input}"
  checkbox-checked:
    backgroundColor: "{colors.background-selected-bold}"
    textColor: "{colors.text-inverse}"
  radio:
    backgroundColor: "{colors.background-input}"
    rounded: "{rounded.full}"
    size: 14px
  radio-checked:
    backgroundColor: "{colors.background-selected-bold}"
    textColor: "{colors.text-inverse}"

  # Lozenge (status pill) — 16px high, 11px bold uppercase
  lozenge-default:
    backgroundColor: "{colors.background-neutral-bold}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.label-lozenge}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-050}"
    height: 16px
  lozenge-success:
    backgroundColor: "{colors.background-success-subtler}"
    textColor: "{colors.text-success}"
    typography: "{typography.label-lozenge}"
    rounded: "{rounded.small}"
  lozenge-removed:
    backgroundColor: "{colors.background-danger-subtler}"
    textColor: "{colors.text-danger}"
    typography: "{typography.label-lozenge}"
    rounded: "{rounded.small}"
  lozenge-moved:
    backgroundColor: "{colors.background-warning-subtler}"
    textColor: "{colors.text-warning}"
    typography: "{typography.label-lozenge}"
    rounded: "{rounded.small}"
  lozenge-inprogress:
    backgroundColor: "{colors.background-information-subtler}"
    textColor: "{colors.text-information}"
    typography: "{typography.label-lozenge}"
    rounded: "{rounded.small}"
  lozenge-new:
    backgroundColor: "{colors.background-discovery-subtler}"
    textColor: "{colors.text-discovery}"
    typography: "{typography.label-lozenge}"
    rounded: "{rounded.small}"

  # Badge (counts)
  badge:
    backgroundColor: "{colors.surface-hovered}"
    textColor: "{colors.text}"
    typography: "{typography.body-small}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-050}"
    width: "{spacing.space-300}"
  badge-primary:
    backgroundColor: "{colors.background-brand-boldest}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.body-small}"
    rounded: "{rounded.small}"

  # Tooltip — dark neutral, body.small, max 240px wide
  tooltip:
    backgroundColor: "{colors.background-neutral-bold}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.body-small}"
    rounded: "{rounded.xsmall}"
    padding: "{spacing.space-075}"
    width: 240px

  # Section message (inline banner) — subtle semantic bg + matching icon
  section-message-information:
    backgroundColor: "{colors.background-information}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-200}"
  section-message-information-icon:
    textColor: "{colors.icon-information}"
  section-message-success:
    backgroundColor: "{colors.background-success}"
    textColor: "{colors.text}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-200}"
  section-message-success-icon:
    textColor: "{colors.icon-success}"
  section-message-warning:
    backgroundColor: "{colors.background-warning}"
    textColor: "{colors.text}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-200}"
  section-message-warning-icon:
    textColor: "{colors.icon-warning}"
  section-message-error:
    backgroundColor: "{colors.background-danger}"
    textColor: "{colors.text}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-200}"
  section-message-error-icon:
    textColor: "{colors.icon-danger}"
  section-message-discovery:
    backgroundColor: "{colors.background-discovery}"
    textColor: "{colors.text}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-200}"
  section-message-discovery-icon:
    textColor: "{colors.icon-discovery}"

  # Banner (page-level, bold)
  banner-error:
    backgroundColor: "{colors.error}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.body-medium-weight}"
    padding: "{spacing.space-150}"
  banner-warning:
    backgroundColor: "{colors.background-warning-bold}"
    textColor: "{colors.text-warning-inverse}"
    padding: "{spacing.space-150}"
  banner-announcement:
    backgroundColor: "{colors.background-neutral-bold-hovered}"
    textColor: "{colors.text-inverse}"
    padding: "{spacing.space-150}"

  # Flag (toast) — raised overlay surface, shadow.overlay
  flag:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.heading-xsmall}"
    rounded: "{rounded.large}"
    padding: "{spacing.space-200}"
    width: 400px
  flag-bold-success:
    backgroundColor: "{colors.background-success-bold}"
    textColor: "{colors.text-inverse}"
  flag-bold-information:
    backgroundColor: "{colors.background-information-bold}"
    textColor: "{colors.text-inverse}"
  flag-bold-discovery:
    backgroundColor: "{colors.background-discovery-bold}"
    textColor: "{colors.text-inverse}"

  # Card / container
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.large}"
    padding: "{spacing.space-200}"
  card-hovered:
    backgroundColor: "{colors.surface-hovered}"
  card-title:
    textColor: "{colors.text}"
    typography: "{typography.heading-small}"
  page-background-sunken:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.text}"
    padding: "{spacing.space-300}"
  skeleton:
    backgroundColor: "{colors.skeleton}"
    rounded: "{rounded.small}"

  # Modal dialog
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.xlarge}"
    padding: "{spacing.space-300}"
    width: "{spacing.modal-width-medium}"
  modal-small:
    width: "{spacing.modal-width-small}"
  modal-large:
    width: "{spacing.modal-width-large}"
  modal-xlarge:
    width: "{spacing.modal-width-xlarge}"
  modal-title:
    textColor: "{colors.text}"
    typography: "{typography.heading-medium}"
  modal-blanket:
    backgroundColor: "{colors.blanket}"

  # Menu / dropdown list item
  menu-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-100}"
    height: 40px
  menu-item-hovered:
    backgroundColor: "{colors.surface-hovered}"
    textColor: "{colors.text}"
  menu-item-pressed:
    backgroundColor: "{colors.background-neutral-pressed}"
  menu-item-selected:
    backgroundColor: "{colors.background-selected}"
    textColor: "{colors.text-selected}"
  menu-item-selected-hovered:
    backgroundColor: "{colors.background-selected-hovered}"
    textColor: "{colors.text-selected-hovered}"
  menu-item-description:
    textColor: "{colors.text-subtlest}"
    typography: "{typography.body-small}"

  # Tabs
  tab:
    textColor: "{colors.text-subtle}"
    typography: "{typography.body-medium-weight}"
    padding: "{spacing.space-100}"
  tab-hovered:
    backgroundColor: "{colors.surface-pressed}"
    textColor: "{colors.text}"
  tab-selected:
    textColor: "{colors.text-selected}"
  tab-selected-indicator:
    backgroundColor: "{colors.border-selected}"
    height: "{spacing.border-width-selected}"
  divider:
    backgroundColor: "{colors.border}"
    height: "{spacing.border-width}"
  divider-bold:
    backgroundColor: "{colors.border-bold}"

  # Page structure & data display
  page-title:
    textColor: "{colors.text}"
    typography: "{typography.heading-large}"
  page-title-form:
    typography: "{typography.heading-xlarge}"
  hero-title:
    typography: "{typography.heading-xxlarge}"
  section-title:
    textColor: "{colors.text}"
    typography: "{typography.heading-xsmall}"
  table-header:
    textColor: "{colors.text-subtle}"
    typography: "{typography.heading-xxsmall}"
  body-long-form:
    textColor: "{colors.on-surface}"
    typography: "{typography.body-large}"
  metadata:
    textColor: "{colors.secondary}"
    typography: "{typography.body-small}"
  metric-hero:
    textColor: "{colors.text}"
    typography: "{typography.metric-large}"
  metric-card:
    textColor: "{colors.text}"
    typography: "{typography.metric-medium}"
  metric-inline:
    textColor: "{colors.text}"
    typography: "{typography.metric-small}"
  code-block:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.text-subtle}"
    typography: "{typography.code}"
    rounded: "{rounded.small}"
    padding: "{spacing.space-100}"
  icon-default:
    textColor: "{colors.icon}"
    size: 16px
  icon-subtle:
    textColor: "{colors.icon-subtle}"
    size: 16px
  avatar:
    rounded: "{rounded.full}"
    size: 32px
  avatar-brand-ring:
    backgroundColor: "{colors.background-brand-subtlest}"
    textColor: "{colors.text-brand}"
  top-navigation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-subtle}"
    height: 48px
    padding: "{spacing.space-150}"
  side-navigation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-subtle}"
    width: 240px
    padding: "{spacing.space-100}"
  side-navigation-item-selected:
    backgroundColor: "{colors.background-selected}"
    textColor: "{colors.text-selected}"
  # Translucent neutral layers — the ADS originals. Use these instead of the opaque
  # surface-* values when the component sits on a non-white surface (sunken panel,
  # selected row, dark mode). Over white they composite to #FFFFFF / #F0F1F2 / #DDDEDD / #B7B9BF.
  overlay-neutral-subtle:
    backgroundColor: "{colors.background-neutral-subtle}"
  overlay-neutral-subtle-hovered:
    backgroundColor: "{colors.background-neutral-subtle-hovered}"
  overlay-neutral:
    backgroundColor: "{colors.background-neutral}"
  overlay-neutral-hovered:
    backgroundColor: "{colors.background-neutral-hovered}"
  focus-ring:
    backgroundColor: "{colors.border-focused}"
    width: "{spacing.border-width-focused}"
  selected-outline:
    backgroundColor: "{colors.border-selected}"
  status-border-warning:
    backgroundColor: "{colors.border-warning}"
  status-border-success:
    backgroundColor: "{colors.border-success}"
  status-border-information:
    backgroundColor: "{colors.border-information}"
  status-border-discovery:
    backgroundColor: "{colors.border-discovery}"
---

# Atlassian Design System — DESIGN.md

## Overview

This file encodes the visual language of the **Atlassian Design System (ADS)**, the system behind Jira, Confluence, Loom, Trello and Rovo. Its stated ambition is that every app across Atlassian's collections "feels cohesive and familiar" through one shared design language; use this file to give your own applications the same property.

**Personality.** Calm, legible, work-first. The UI is a tool for teams doing dense, repetitive knowledge work (triaging tickets, editing pages, reading dashboards), so it optimizes for scanning speed and low fatigue over spectacle. Concretely:

- **Dense but not cramped.** The default body size is 14px/20px, not 16px. Components are compact (32px buttons, 40px menu items) and spacing sits on an 8px grid with 2px, 4px and 6px half-steps for tight UI.
- **Neutral-dominant canvas, one action color.** Almost every pixel is white, near-white, or a gray; Atlassian Blue (`#1868DB`) is reserved for the primary action, links, selection and brand moments.
- **Meaning-bearing color.** Every non-neutral color answers the question "what does this mean?": brand, information, success, warning, danger, discovery. Decorative color comes only from the separate *accent* set, which carries no meaning.
- **Semantic tokens, never raw values.** ADS is token-first. A designer picks `color.background.danger.bold`, not `Red700`; the token resolves differently in light, dark and increased-contrast themes. Treat the hex values in the front matter as the light-theme resolution of those tokens.

**Audience.** Professional teams (software, IT, business) using the product for hours a day, on desktop first, then mobile.

**Theme scope.** The tokens above are the default **light** theme. ADS ships dark, increased-contrast and legacy themes from the same token names; see *Dark mode* under Colors.

## Colors

ADS separates **primitive palettes** (ramps named `Blue100`…`Blue1000`, `Neutral0`…`Neutral1200`) from **semantic tokens** (`color.text`, `color.background.brand.bold`). Product UI uses only semantic tokens; primitives exist to build themes. The front matter maps every token to its primitive in a trailing comment.

### Token anatomy

Every ADS color token reads as a sentence: `color` · *property* · *role* · *emphasis* · *state*.

| Segment | Values | Example |
|---|---|---|
| property | `text`, `icon`, `border`, `background`, `link`, `blanket`, `skeleton`, `chart` | `color.border` |
| role | `neutral`, `brand`, `information`, `success`, `warning`, `danger`, `discovery`, `accent.*`, `inverse`, `input`, `selected` | `color.text.danger` |
| emphasis | `subtlest` → `subtler` → `subtle` → (default) → `bold` → `bolder` → `boldest` | `color.background.success.bold` |
| state | `hovered`, `pressed`, `focused`, `selected`, `disabled`, `visited` | `color.background.brand.bold.hovered` |

In this file, `color.background.brand.bold` is written `background-brand-bold`.

### Roles

- **Atlassian Blue / Brand — Primary (#1868DB).** Primary buttons, links, selected states, brand moments. Hover darkens one ramp step (#1558BC), press two (#144794). One primary button per view.
- **Ink — On-surface / Text (#292A2E).** All default text and icons. Never pure black.
- **Slate — Secondary / Text subtle (#505258).** Secondary text, default-button labels, navigation items, field labels.
- **Fog — Text subtlest (#6B6E76).** Placeholders, helper text, timestamps, metadata. Still passes 4.5:1 on white (≈5.1:1).
- **Discovery Purple — Tertiary (#964AC0).** New features, onboarding, spotlights, "try this". Not a decorative purple.
- **Information (#1868DB bold / #E9F2FE subtle).** Neutral-positive information and "in progress". Shares hues with brand but is semantically distinct.
- **Success Lime (#5B7F24 bold / #EFFFD6 subtle).** Completed, done, favorable outcomes. Note: ADS success is a lime-green, not the teal-green used by many systems.
- **Warning Amber (#FBC828 bold / #FFF5DB subtle).** Cautions before a mistake. Bold warning is a light yellow, so it takes **dark** text (`text-warning-inverse`, #292A2E), not white.
- **Danger Red — Error (#C9372C bold / #FFECEB subtle).** Errors, destructive actions, blocking problems.
- **Paper — Surface (#FFFFFF).** The default page and every raised/overlay surface.
- **Limestone — Neutral / Surface sunken (#F8F8F8).** Recessed regions: board columns, side panels, code blocks — areas that sit *behind* cards.

### Neutral ramp and alpha neutrals

| Primitive | Hex | Typical token |
|---|---|---|
| Neutral0 | #FFFFFF | `elevation.surface`, `text.inverse` |
| Neutral100 | #F8F8F8 | `elevation.surface.sunken` |
| Neutral200 | #F0F1F2 | `elevation.surface.hovered` |
| Neutral300 | #DDDEE1 | `elevation.surface.pressed` |
| Neutral500 | #8C8F97 | `border.input` |
| Neutral600 | #7D818A | `border.bold` |
| Neutral700 | #6B6E76 | `text.subtlest` |
| Neutral800 | #505258 | `text.subtle` |
| Neutral1000 | #292A2E | `text`, `background.neutral.bold` |
| Neutral100A–500A | #17171708 → #050C1F75 | `background.neutral*`, `border`, `blanket` |

Neutral backgrounds (`background-neutral`, `border`, `disabled`) are **translucent** (alpha neutrals), so a gray chip looks correct on white, on a sunken panel, and on a hovered row without a separate token for each. Keep them translucent when you port this system. The `components` block uses their opaque equivalents over white (`surface-hovered` #F0F1F2 = Neutral200A on white, `surface-pressed` ≈ Neutral300A on white) so contrast can be verified; the `overlay-neutral-*` components carry the translucent originals for use on any other surface.

### Accent colors

Ten accents — gray, red, orange, yellow, lime, green, teal, blue, purple, magenta — exist for meaning-free categorization: labels, avatars, calendar events, chart series. Each has `subtlest / subtler / subtle / bolder` backgrounds plus text, border and icon variants (e.g. `color.background.accent.teal.subtler` #C6EDFB with `color.text.accent.teal` #206A83). Never use an accent where a semantic role applies: a red "Overdue" label is `danger`, not `accent.red`.

### Interaction states

- **Hovered / pressed** are transient and layer on top of the current state. For a bold background, step one ramp darker on hover and two on press.
- **Selected** is persistent: `background-selected` (#E9F2FE) + `text-selected` (#1868DB). Pair it with a non-color cue (check mark, left bar, underline) — selection must never rely on color alone.
- **Focused** uses `border-focused` (#4688EC) **only** for keyboard focus. If an item is both selected and focused, keep the selected styling and add the focus ring.
- Do not use brand, link, or focused tokens to show selection.
- Icons have no hovered tokens; put the icon in a `background-neutral-subtle` container and change the container on hover.

### Contrast

- Text under 24px: **≥ 4.5:1** (WCAG 1.4.3).
- Text 24px and up, and essential non-text UI (input borders, icons, focus rings): **≥ 3:1** (WCAG 1.4.11).
- On any `*.bold` background, use `inverse` text/icon tokens (white), **except** bold warning, which uses `text-warning-inverse` (dark ink).

### Dark mode

Same token names, different resolution. Key dark values: surface #1F1F21, raised #242528, overlay #2B2C2F, sunken #18191A, text #CECFD2, text-subtle #A9ABAF, text-subtlest #96999E, brand bold #669DF1 (hover #8FB8F6), focus #8FB8F6, border #E3E4F21F, link #669DF1, text-inverse #1F1F21. Dark mode raises elevation by *lightening* surfaces, not by shadow.

## Typography

**Families.**
- **Atlassian Sans** — every in-product heading, body, label and metric. Fallback stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif`.
- **Atlassian Mono** — code only. Fallback: `ui-monospace, Menlo, "Segoe UI Mono", "Ubuntu Mono", monospace`.
- **Charlie Display / Charlie Text** — brand and marketing only; never in product UI.

**Weights.** Four: regular 400, medium 500, semibold 600, bold **653** (Atlassian Sans is variable; 653 is the exact bold axis value — fall back to 700 if your font is static). Headings and metrics are bold; body is regular; component labels (buttons, tabs, menu items beside icons) use medium.

**Scale.** All sizes are rem-based on a 16px root so browser zoom scales text. Line heights are fixed pixel values that land on a 4px grid.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| heading-xxlarge | 32/36 | 653 | Brand and marketing heroes |
| heading-xlarge | 28/32 | 653 | App page titles (form titles) |
| heading-large | 24/28 | 653 | App page titles |
| heading-medium | 20/24 | 653 | Modal titles, large components; pairs with body-large |
| heading-small | 16/20 | 653 | Card titles, flag titles |
| heading-xsmall | 14/20 | 653 | Section titles in small components |
| heading-xxsmall | 12/16 | 653 | Table headers, fine-print headings (sparingly) |
| body-large | 16/24 | 400 | Long-form reading (Confluence pages, blogs) |
| body | 14/20 | 400 | **Default** for components and app UI |
| body-small | 12/16 | 400 | Fine print, helper text, tooltips (sparingly) |
| metric-large/medium/small | 28/32, 24/28, 16/20 | 653 | Emphasized numbers on dashboards |
| code | 12/20 | 400 | Code blocks; inline code renders at 0.875em of its container |

**Rules.**
- One `h1` per page; never skip heading levels. Pick the heading *level* for document structure and the heading *token* for visual size — they are independent.
- Mark headings with heading tokens, not by bolding body text.
- Paragraph spacing: 16px after body-large, 12px after body, 8px after body-small.
- No letter-spacing adjustments and no all-caps, with one exception: lozenges (11px bold uppercase).

## Layout

**Spacing scale.** Base unit **8px** = `space.100`. The token number is the percentage of the base: `space.150` = 150% = 12px, `space.050` = 50% = 4px. Use tokens for all gaps and padding; never a raw 10px or 15px.

| Band | Tokens | Use |
|---|---|---|
| Small (0–8px) | `space.0`, `.025`, `.050`, `.075`, `.100` | Icon-to-label gap (4px), badge/lozenge padding (4px), input padding (6px), button-group gap (4–8px), trigger-to-menu gap (8px), title-to-description inside a card |
| Medium (12–24px) | `.150`, `.200`, `.250`, `.300` | Button horizontal padding (12px), card padding (16px), avatar-to-content gap in messages (16px), modal padding (24px) |
| Large (32–80px) | `.400`, `.500`, `.600`, `.800`, `.1000` | Page-level gaps (top of page to header), separation of major layout regions |
| Negative (−2 to −32px) | `space.negative.*` | Bleeding out of a parent's padding (full-width dividers, edge-to-edge images); prefer a Bleed primitive |

**Composition principles.**
1. **Group by proximity.** Related items closer, unrelated farther: a field's label sits 4px above it; separate fields sit 16px apart; separate form sections 32px apart.
2. **Group by similarity.** Repeated items (rows, list items, cards in a board column) share identical spacing so they read as one set.
3. **Hierarchy through whitespace.** Increase space before a section heading more than after it.
4. **Rhythm with deliberate breaks.** Keep spacing regular; break it only to create a focal point.
5. **Optical adjustment.** Nudge by 1–2px when an icon or glyph looks off-center, even if the numbers match.

**App shell.** Fixed top navigation (48px), collapsible side navigation (≈240px), main content on `surface`, secondary panels on `surface-sunken`. Content uses a fluid 12-column grid; long-form reading columns cap at roughly 760px so body-large lines stay ~75 characters.

**Modal widths.** small 400px, medium 600px (default), large 800px, x-large 968px.

## Elevation & Depth

ADS expresses depth with a pairing of **surface token + shadow token**. Always use the pair; a raised surface without its shadow, or a shadow on the wrong surface, breaks dark mode.

| Level | Surface | Shadow (light) | Use |
|---|---|---|---|
| Sunken | `elevation.surface.sunken` #F8F8F8 | none | Board columns, recessed side areas, code blocks |
| Default | `elevation.surface` #FFFFFF | none | The page itself |
| Raised | `elevation.surface.raised` #FFFFFF | `0 1px 1px #1E1F2140, 0 0 1px #1E1F214F` | Cards that can be moved or opened (Jira cards) |
| Overlay | `elevation.surface.overlay` #FFFFFF | `0 8px 12px #1E1F2126, 0 0 1px #1E1F214F` | Dropdowns, popups, modals, flags, tooltips' container |
| Overflow | — | `0 0 8px #1E1F2129, 0 0 1px #1E1F211F` | Scroll shadows signalling hidden content |

- **Blanket** (`#050C1F75`, ~46% navy-black) dims the page behind modals.
- Surfaces have hovered/pressed variants (#F0F1F2 / #DDDEE1) for clickable cards.
- In dark mode, height is shown by surface lightness (sunken #18191A < default #1F1F21 < raised #242528 < overlay #2B2C2F); shadows recede.
- Prefer one elevation level per region; do not stack raised cards inside raised cards.
- Opacity: disabled content at 0.4, loading content at 0.2.

## Shapes

Shape language: **soft rectangles**. Corners are rounded enough to feel approachable, never pill-shaped except for avatars and toggles. Radius scales with component size: the larger the object, the larger the radius.

| Token | Value | Applied to |
|---|---|---|
| radius.xsmall | 2px | Tooltips, checkbox boxes, small inline marks |
| radius.small | 4px | Buttons, lozenges, badges, section messages, menu items |
| radius.medium | 6px | Text fields, selects, text areas |
| radius.large | 8px | Cards, popups, dropdown menus, flags |
| radius.xlarge | 12px | Modals |
| radius.xxlarge | 16px | Large panels and hero containers |
| radius.full | 9999px | Avatars, radio buttons, toggles |
| radius.tile | 25% | Square tiles / app icons (proportional) |

**Borders.** `border.width` 1px for inputs, dividers and default buttons; 2px (`border.width.selected`, `border.width.focused`) for selection indicators and focus rings. Focus rings sit outside the element with a 2px offset so they never cover content.

**Iconography.** 16px default (12px small, 24px large) line icons, `color.icon` by default, `color.icon.subtle` for secondary. Icons beside text use medium-weight text so stroke weights match.

## Components

All components inherit `body` (14/20) unless noted. Sizes below are the ADS defaults.

### Buttons
- **Height** 32px default, 24px compact. **Padding** 12px horizontal (6px compact), 6px vertical. **Gap** icon-to-label 6px (4px compact). **Radius** 4px. **Label** body at weight 500.
- **Primary** — brand bold #1868DB, white text. One per view; the step that moves work forward ("Create", "Save").
- **Default** — transparent/white with a 1px `color.border` outline and `text-subtle` label. Everything that is not the primary action.
- **Subtle** — no background or border until hover (`background-neutral-subtle-hovered`). Toolbars, icon buttons, dense tables.
- **Danger** — red bold #C9372C, white text. Only for destructive confirmations ("Delete project"), usually inside a modal.
- **Warning** — amber #FBC828 with **dark** text. Proceed-with-caution actions.
- **Discovery** — purple #964AC0. Onboarding and "try new feature" CTAs only.
- **Selected** — toggle buttons in the on-state: `background-selected` + `text-selected`.
- **Disabled** — `background-disabled`, `text-disabled`; no hover, no pointer. Contrast is deliberately ≈1.7:1; WCAG 1.4.3 exempts inactive controls, so the linter's warning on `button-disabled` is expected. Never use disabled styling on anything the user must read.
- **Icon button** — square (32×32 / 24×24), subtle by default; always has an accessible label and tooltip.
- **Split button / button group** — 4px gap between grouped buttons.

### Text fields, selects, text areas
- White `background-input`, 1px `border-input` (#8C8F97), radius 6px, inner padding 6px horizontal.
- Hover: `background-input-hovered` (#F8F8F8). Focus: border becomes 2px `border-focused` (#4688EC).
- Invalid: 1px `border-danger` plus an error message below in `text-danger` with an error icon.
- Label above the field in body-small/`text-subtle`, 4px gap; required fields marked with an asterisk in `text-danger`.
- Helper text below in body-small/`text-subtlest`.
- Placeholder text is a hint, never a replacement for the label.

### Checkbox & radio
- 14px control inside a 24px hit area; checkbox radius 2px, radio full.
- Unchecked: white with 1px `border-input`; checked/indeterminate: `background-selected-bold` with white glyph.
- Label to the right, 8px gap, body text.

### Lozenge (status)
- 16px high, 4px horizontal padding, radius 4px, **11px bold uppercase**.
- Appearances map to meaning: default (gray), success ("DONE"), removed (red, "BLOCKED"), moved (amber, "AT RISK"), inprogress (blue, "IN PROGRESS"), new (purple, "NEW").
- Subtle variant (subtler background + role text) is default; bold variant (bold background + inverse text) for high emphasis.

### Badge
- Numeric counts. 24px min-width, 4px horizontal padding, radius 4px, body-small.
- Default `background-neutral`; primary uses `background-brand-boldest` (#1C2B42) with white text; important uses danger bold.

### Tooltip
- `background-neutral-bold` (#292A2E), white body-small text, radius 2px, padding 2px 6px, max width 240px.
- Appears on hover/focus after a short delay; never contains interactive content.

### Section message & banner
- **Section message** (inline): subtle semantic background (`information`, `success`, `warning`, `danger`, `discovery`), 16px padding, radius 4px, 24px role icon on the left with 16px gap, heading-small title, body text, optional subtle-link actions.
- **Banner** (page-level, top of page): bold background, inverse text (dark on warning), 12px padding, no radius, one line.

### Flag (toast)
- Overlay surface with `shadow.overlay`, radius 8px, 16px padding, 400px wide, stacked bottom-left.
- Icon + heading-xsmall title + body description + up to two link actions. Bold variants (success, information, discovery, warning, error) for high-priority messages.
- Enters with `motion.flag.enter` (250ms slide+fade), auto-dismiss for non-critical messages only.

### Cards
- Raised surface, `shadow.raised`, radius 8px, 16px padding, heading-small title, 8px between title and description.
- Clickable cards use `surface-hovered` / `surface-pressed`.

### Modal dialog
- Overlay surface, `shadow.overlay`, radius 12px, 24px padding, widths 400/600/800/968px.
- Header: heading-medium title (+ optional close icon button). Footer: right-aligned buttons, primary last, 8px gap.
- Behind it: `blanket`. Focus is trapped inside; Esc closes.

### Menus & dropdowns
- Overlay surface, radius 8px, 4–8px vertical padding.
- Item: 40px min height (32px compact), 8px/12px padding, transparent → `background-neutral-subtle-hovered` → `background-neutral-pressed`.
- Selected item: `background-selected` + `text-selected` + check icon or 2px left bar.
- Secondary line in body-small/`text-subtlest`.

### Tabs
- Medium-weight body labels in `text-subtle`; hover `text`; selected `text-selected` with a 2px `border-selected` underline indicator. 1px `border` divider under the tab list.

### Navigation
- Top nav 48px, white surface, 1px bottom `border`. Side nav ~240px, items are menu items with 4px radius; current page = selected styling.

### Avatars
- Circles at 16/24/32/40/48/96px; 32px default. Project/app avatars use square `radius.tile`. Presence and status dots overlap the bottom-right edge.

### Data display
- Tables: heading-xxsmall headers in `text-subtle`, body cells, 8px cell padding, 1px `border` row dividers; hovered row `background-neutral-subtle-hovered`.
- Dashboards: metric tokens for headline numbers; charts use `color.chart.categorical.1–8` (#357DE8, #82B536, #BF63F3, #F68909, #1558BC, #964AC0, #42B2D7, #BD5B00) in that order.
- Empty states: heading-medium title, body description, one primary button, optional illustration ≤ 160px.
- Loading: `skeleton` blocks with the shape of the content, not spinners, for page-level loads.

### Motion

Motion is a clarifying layer, never decoration. Principles: **human** (organic, not mechanical), **clarity**, **accessible**, **performant**.

| Duration token | ms | Typical use |
|---|---|---|
| motion.duration.xxshort | 50 | List-item hover |
| motion.duration.xshort | 100 | Popup / avatar / form-message exit |
| motion.duration.short | 150 | Button & input state changes, popup/dropdown entrance |
| motion.duration.medium | 200 | Modal, flag, panel exit |
| motion.duration.long | 250 | Modal, flag, panel, blanket entrance |
| motion.duration.xlong | 400 | Large transitions (upper bound) |
| motion.duration.xxlong | 600 | Rare expressive moments |

| Easing token | cubic-bezier | Use |
|---|---|---|
| motion.easing.out.bold | (0, 0.4, 0, 1) | Panels and flags entering |
| motion.easing.inout.bold | (0.4, 0, 0, 1) | Scaling modals, repositioning |
| motion.easing.in.practical | (0.6, 0, 0.8, 0.6) | Exits |
| motion.easing.out.practical | (0.4, 1, 0.6, 1) | Popups, hover fades, button/input state |

Semantic bundles (prefer these over raw durations): `motion.popup.enter.*` 150ms slide 8px + fade; `motion.popup.exit.*` 100ms slide 4px + fade; `motion.modal.enter` 250ms scale 95→100%; `motion.modal.exit` 200ms scale 100→95%; `motion.flag.enter` 250ms slide-in-from-left 50% + fade; `motion.panel.enter` 250ms slide 100%; `motion.button.hovered` 150ms on background/border color.

Rules: interactions 50–150ms; transitions 150–400ms; larger elements get longer durations; anything seen dozens of times a day stays under 150ms; **exits are faster than entrances**; one focal animation at a time; with `prefers-reduced-motion`, all motion becomes instant; never flash, oscillate rapidly, or sweep large areas.

### Content and voice

Language is clear, concise and consistent, inclusive, and easy to localize.
- **Sentence case** everywhere: buttons, headings, menu items, tabs ("Create issue", not "Create Issue"). Product names keep their capitals.
- **Buttons are verbs** that name the outcome ("Delete page", "Save changes"), not "OK" or "Yes". The danger button repeats the destructive verb from the modal title.
- **Errors** say what happened and how to fix it, without blame: "This email is already in use. Try signing in instead." — not "Invalid input!".
- **Contractions** are fine; they keep the tone human ("can't", "you'll").
- **Second person** ("your projects"); no exclamation marks except in genuine celebrations; no jargon, idioms or culture-specific humor that fails in translation.
- **Dates/times** in the reader's locale and time zone; relative ("2 hours ago") for recent activity, absolute for anything older than a week.

## Do's and Don'ts

- **Do** use semantic tokens (`background-danger-bold`) rather than primitives (`Red700`) or raw hex, so light, dark and high-contrast themes keep working.
- **Do** keep exactly one primary (blue) button per view; everything else is default or subtle.
- **Don't** use blue for selection on non-interactive decoration, and don't use brand, link or focus tokens to indicate selection — use `selected` tokens plus a non-color cue.
- **Do** put dark text on bold warning (#FBC828); **don't** put white text on it.
- **Don't** use accent colors to carry meaning or semantic colors to decorate: red is for danger, not for "the red team".
- **Do** default to 14px body in product UI; reserve 16px body-large for long-form reading.
- **Don't** exceed three type sizes in a single component, and don't bold body text to fake a heading.
- **Do** space everything on the 8px scale (with 2/4/6px half-steps); **don't** introduce 10px, 15px or 18px gaps.
- **Do** match radius to size: 4px buttons, 6px inputs, 8px cards, 12px modals. **Don't** use pill shapes for buttons.
- **Do** pair every elevated surface with its matching shadow token; **don't** add custom drop shadows.
- **Do** maintain WCAG AA: 4.5:1 for text under 24px, 3:1 for large text and essential UI (input borders, focus rings, icons).
- **Do** show keyboard focus with the 2px #4688EC ring on every interactive element; **never** remove outlines without a replacement.
- **Do** make exits faster than entrances and keep frequent interactions under 150ms; **don't** animate when reduced motion is requested.
- **Do** write in sentence case with verb-first button labels; **don't** use "OK", "Submit" or "Click here".
- **Don't** use Charlie (brand) fonts inside product UI; Atlassian Sans and Atlassian Mono only.
