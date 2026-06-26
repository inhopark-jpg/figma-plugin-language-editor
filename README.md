# Language Variables Editor

A Figma plugin for managing text-translation string variables that live in a
collection named **`language`**. The variable grouping mirrors the canvas
**Page > Section > Section** hierarchy.

## Install (development)

1. Figma desktop app → **Plugins → Development → Import plugin from manifest…**
2. Select `manifest.json` in this folder.
3. Run it from **Plugins → Development → Language Variables Editor**.

There is no build step — `code.js` and `ui.html` are loaded directly.

## What it does

- **Edit** — select a text layer with a linked variable to see every mode's
  value in editable fields. *Confirm* writes, *Cancel* / closing the plugin /
  selecting another layer discards.
- **Swap / Assign** — pick from existing `language` variables in the layer's
  current Page/Section group. Searchable by name **and** value. On swap the
  current variable is centered in the list. Empty group shows a "no variables"
  message.
- **Create** — make a new variable inside the matching group, with one input per
  mode. Blank non-default modes become `-`. The name is the default-mode value
  with non-`[A-Za-z0-9_]` characters replaced by `_`, truncated to **Max len**
  (default 20, editable in the header).
- **Clean up names** (header button) — renames every variable in `language` to
  follow the naming rule based on its default value.
  e.g. value `a flying fox!` → name `a_flying_fox_`.

## Notes on node support

- **Plain text layers** bind via `setBoundVariable('characters', …)`.
- **Component instances** whose text comes from a TEXT property bind via the
  property (`setProperties` + `createVariableAlias`). The plugin resolves both
  when you select either the text layer or the instance.
- Figma's "Page/Section" grouping is enforced by you on the canvas; the plugin
  reads `SECTION` ancestors plus the page name to compute each group.
