# Context architecture

## Pipeline

The matrix parser first creates bounded entities, profile cells, host selection identities, context
values, coordinate pairs, and geometry text. Context preprocessing then:

1. validates complete WGS84 point pairs;
2. enforces 32,000 UTF-16 characters per value and 2,000,000 characters per update;
3. parses only strict GeoJSON Geometry/Feature or strict WKT Point, MultiPoint, Polygon, MultiPolygon;
4. rejects unknown CRS, `GeometryCollection`, malformed rings, non-finite values, and out-of-range
   coordinates;
5. enforces depth 12, 256 rings/feature, 4,096 vertices/feature, 100,000 vertices/scene, 16,384 WKT
   tokens, 4,000 entities/trusted built-in pack features, and 1,000 untrusted bound features.

No preprocessing reads files, uploads data, calls a network service, evaluates source text, applies a
projection, guesses a CRS, or loads a geography pack.

If legacy GeoJSON includes a `crs` object, its `name` is matched against a closed, exact,
case-insensitive allowlist: `CRS84`, `EPSG:4326`, `EPSG::4326`,
`urn:ogc:def:crs:OGC:1.3:CRS84`, and `urn:ogc:def:crs:EPSG::4326`. Prefixes, suffixes,
whitespace variants, and URL forms are rejected.

Generated grid/hex ranks and spatial-navigation tie-breakers compare opaque stable keys by JavaScript
UTF-16 code-unit order. They never use locale collation, so host locale and `Intl` configuration
cannot change placement or focus behavior.

## Provider extension contract

`ContextProvider` is the only provider boundary:

- `id`: stable provider identifier;
- `modes`: supported `ContextMode` values;
- `canProvide(mode, input)`: side-effect-free availability check;
- `provide(mode, input)`: returns a bounded `ContextScene`.

`ContextProviderInput` contains entities, host identities, context values, validated coordinates, and
bounded geometry text. A scene contains provider/mode IDs, `ContextFeature` values, feature/ring/vertex
metrics, diagnostics, and partial state. Each feature carries a stable entity key, host identity,
normalized geometry, context value, and tooltip values.

The shipped registry resolves `none`, `points`, `boundGeometry`, `grid`, `hex`, and one generic
`builtInPack` provider backed by a separate artifact registry. A provider must not
touch the DOM, Power BI host, storage, files, or network. Renderers depend only on `ContextScene`, so a
new provider cannot bypass shared rendering, interaction, diagnostics, and accessibility behavior.

Built-in pack artifacts are generated before packaging from pinned, hash-verified public-domain
sources. Runtime decoding and projection produce the same generic point/polygon scene geometry as
other providers. Pack canonical keys are lookup-only; `ContextFeature.key` and selection identity
remain the report entity's stable key and matrix identity. Exact key modes reject coercion, fuzzy
names, unmatched values, and ambiguous duplicate normalized keys. See
[context-packs.md](context-packs.md).

## Layout and rendering

The composite layout supports `split`, `focusLens`, `locatorInset`, and `profileOnly`; small viewports
fall back deterministically. A scene uses SVG only at 500 or fewer features and 20,000 or fewer
vertices. Otherwise accepted scenes use Canvas. Scene limits apply before renderer selection.

Both renderers use the same transform, selection identities, hit-test target keys, focus state,
tooltip content, and accessible descriptions. Canvas is a rendering optimization, not a reduced
semantic mode.

Canvas hit testing reads the color-picking pixel before geometry work, performs O(1) feature and
interaction-target lookups, and validates at most one picked feature plus 32 reverse-scene candidates
from a 32-pixel spatial bucket. The picking buffer uses fills without inflated strokes, so shared
boundaries do not overwrite neighboring interiors. A bounded localized fallback preserves underlying
feature, hole, overlap, and shared-edge parity without an all-scene pointer scan. Buckets retain at
most 32 highest-render-order features; a picked feature always keeps one validation slot. Features
covering more than 256 picking buckets move to a 32-entry global large-feature list, bounding index
construction and storage at large viewports.

## Detail loading

`auto`, `eager`, `segmented`, and `external` are user-selectable. Auto chooses segmented when the
DataView has a segment marker, otherwise eager. Segmented loading requests at most four segments.
External loading treats report filters as authoritative.

`matrixExpand` remains an internal unavailable interface. Capabilities do not declare
`expandCollapse` or `drilldown`; those remain absent until native host evidence establishes their
behavior.

## Interaction boundary

Context features resolve to entity-level matrix identities and profile marks retain bucket-level
identities. The shared controller owns selection, multi-selection, tooltip, context-menu, keyboard
focus, and disabled-interaction behavior. Report selection is the default entity action. Local-only
mode makes no host mutation. Highlights, RLS, external filters, and external selections remain
read-only host inputs. The visual declares no filter capability and never calls `applyJsonFilter`.

Navigation and activation are separate state transitions. Spatial arrow keys update local entity
focus, the header, and `aria-activedescendant` without mutating host selection or filters. Pointer
click and Enter/Space activate the focused entity according to the configured interaction mode.
The only v1 modes are local focus and host report selection; neither writes an outward filter.

The semantic status and profile table remain available at every responsive size. Feature descriptions,
focus order, selected state, tooltip text, high-contrast cues, RTL, and reduced-motion behavior are
kept equivalent between SVG and Canvas.

## Security and proof boundary

Privileges are empty. The implementation has no file access, upload, network calls, `eval`, or
`Function` construction and accepts no executable provider payload.

Unit and packaged-browser checks can prove bounded parsing, deterministic scenes, renderer policy,
interaction calls, and semantic parity in the test environment. They cannot prove native Desktop or
service host behavior. The Desktop checklist is therefore required for each release candidate.
Certification is not claimed.
