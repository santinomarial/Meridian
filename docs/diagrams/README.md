# Architecture diagram assets

The Markdown documentation embeds static, theme-aware SVGs from `rendered/`.
This keeps diagrams readable in both GitHub color schemes without GitHub's
interactive Mermaid pan and zoom controls.

Editable Mermaid definitions live in `source/` and are the source of truth.
Keep each light and dark SVG pair in sync whenever a definition changes.

From the repository root, regenerate every diagram with Mermaid CLI 11.16.0:

```sh
for source in docs/diagrams/source/*.mmd; do
  name="${source##*/}"
  name="${name%.mmd}"
  npx --yes @mermaid-js/mermaid-cli@11.16.0 \
    -i "$source" \
    -o "docs/diagrams/rendered/${name}-light.svg" \
    -t default \
    -b '#ffffff'
  npx --yes @mermaid-js/mermaid-cli@11.16.0 \
    -i "$source" \
    -o "docs/diagrams/rendered/${name}-dark.svg" \
    -t dark \
    -b '#0d1117'
done
```

Embed each diagram with a `<picture>` element that selects the dark or light
render using `prefers-color-scheme`. Give the fallback `<img>` concise alt text
that describes the architecture or sequence rather than its visual styling.
