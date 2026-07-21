# UI styling contract

The application's reusable visual styling lives in [`src/index.css`](../../index.css).

Use that file for changes that should affect the product as a whole:

- `@theme inline` exposes fonts, radii, shadows, and semantic colors to Tailwind.
- `:root` contains the light theme plus shared control measurements and motion tokens.
- `.dark` contains dark-theme token overrides.
- `@layer components` contains the `ui-*` recipes used by the React primitives in this folder.

Component files should keep only structure and context-specific layout in their
`className` values. Reusable visual decisions—color, border, radius, shadow,
typography, control height, and interaction states—belong in a `ui-*` recipe.

For example, change `--radius-md` once to retune standard corners, or update
`.ui-button-outline` once to change every outline and secondary button.

When adding a new reusable primitive:

1. Reuse an existing semantic token and `ui-*` recipe when possible.
2. Add a new token only when the value is meant to be shared.
3. Put the reusable visual recipe in `@layer components`.
4. Keep responsive placement, one-off dimensions, and component layout local.
