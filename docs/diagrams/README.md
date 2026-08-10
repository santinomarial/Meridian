# Architecture diagram assets

The Markdown documentation embeds static, theme-aware SVGs from `rendered/`.
This keeps diagrams readable in both GitHub color schemes without GitHub's
interactive Mermaid pan and zoom controls.

Editable Mermaid definitions live in `source/` and are the source of truth.
Keep each light and dark SVG pair in sync whenever a definition changes.

## Design conventions

Every diagram should remain understandable when viewed by itself:

- Start with a visible title that names the diagram type and scope, such as
  system context, container, component, deployment, dynamic sequence, or
  physical ERD.
- Keep one abstraction level per diagram. Put people and external systems
  outside the Meridian boundary, and draw container or trust boundaries when
  they affect ownership, networking, or security.
- Use directional, labeled relationships for structure and data flow. Reserve
  dashed return arrows for sequence responses, and avoid bidirectional arrows
  when two explicit flows communicate the behavior more clearly.
- Label important nodes with both their responsibility and implementation
  technology. Do not rely on color alone to convey meaning.
- Favor a balanced layout with short edge routes and readable labels. Split a
  diagram when preserving the detail would otherwise require excessive zoom.
- In physical ERDs, `PK`, `FK`, and `UK` mean primary key, foreign key, and
  unique key. Put relationship constraints on the relationship and field
  labels instead of adding decorative legends.

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
Set an explicit `width` on the `<img>` so narrow or tall SVGs do not expand to
the full GitHub content width; the browser will still scale them down on small
screens.
