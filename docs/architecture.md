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
bounded geometry text. A scene contains provider/mode IDs, a complete ordered `ContextBackdrop`,
optional `ContextEntityBinding` maps, diagnostics, and partial state. Each `ContextFeature` is pure
provider-canonical geometry. A binding references one feature key and carries the stable report Entity
key/index/label, host identity, context value, and tooltip values. Geometry is never duplicated in a
data overlay.

The shipped registry resolves `none`, `points`, `boundGeometry`, `grid`, `hex`, and one generic
`builtInPack` provider backed by a separate artifact registry. A provider must not
touch the DOM, Power BI host, storage, files, or network. Renderers depend only on `ContextScene`, so a
new provider cannot bypass shared rendering, interaction, diagnostics, and accessibility behavior.

Built-in pack artifacts are generated before packaging from pinned, hash-verified public-domain
sources. Runtime decoding and projection produce the same generic point/polygon scene geometry as
other providers. A pack feature key is its exact canonical cartographic key. Exact report matches
create separate Entity bindings and reverse maps without changing that feature key or matrix identity.
Exact key modes reject coercion, fuzzy names, unmatched values, and ambiguous duplicate normalized
keys. Unbound pack features remain ordinary backdrop rather than errors. See
[context-packs.md](context-packs.md).

The built-in provider is available from pack configuration alone. It returns the complete backdrop
when the DataView has zero Entity rows, all report keys are unmatched, or profile roles are not yet
renderable. Later bindings update only mapping/dynamic state; unchanged geometry identity preserves
the camera, SVG paths or Canvas base raster, and picking index.

## Layout and rendering

The composite layout supports `split`, `focusLens`, `locatorInset`, and `profileOnly`; small viewports
fall back deterministically. A scene uses SVG only at 500 or fewer features and 20,000 or fewer
vertices. Otherwise accepted scenes use Canvas. Scene limits apply before renderer selection.

`focusLens` draws a screen-space containment: a translucent scrim over the cartography with a clear
circular aperture on the fixed center probe, a rim, and every arm anchored outside the aperture. The
scrim, mask, and rim live in the chart SVG, carry no identity, are `aria-hidden`, and are excluded
from pointer events, so picking, selection, tooltips, the semantic option list, and the accessible
table are unchanged, and probe transitions rebuild no provider, scene, reference geometry, base
raster, or picking index. The treatment is inert for `split`, `locatorInset`, and `profileOnly`, and
can be turned off per report. It stays drawn through the designed empty state, so the map never
flashes between dimmed and live when the probe crosses empty geography.

High contrast resolves the lens away entirely, before layout runs. The aperture is load bearing —
it pushes `bandStart` outward — so suppressing only the paint would still move every arm; the
composition therefore reports no containment at all and arm geometry is byte-identical to the
lens-off composition. The renderer refuses to paint a lens under high contrast as a second,
independent guarantee. This is deliberate: the host supplies exactly two colors, a veil would wash
one of them out, and a rim drawn in the foreground is one more ring competing with map geometry
already drawn in that same single color.

Chart proportions come from a fixed design box scaled uniformly into the chart rectangle, so bar
thickness, gaps, label type, and the aperture keep their relative weights as the tile shrinks rather
than being recomposed at every size. Single-axis layouts spend the whole chart box: the band axis
length and the perpendicular value budget are solved from the oriented rectangle that fits the box at
the current arm rotation, and a single-series bilateral arm drops its baseline by half the budget so
the drawn band is centered instead of leaving a blank half. Radiating arms reach along an inscribed
ellipse, capped so a wide tile is spent without the star sprawling to the edges. A mirrored arm
reserves a gutter on its axis, sized to the band label's extent along that arm's perpendicular and
taken out of the magnitude budget, which is where a population pyramid carries its band scale.

Every chart label — band labels on every arm, arm captions, per-arm scale annotations, and value
labels — goes through one deterministic placement pass. Candidates are sorted by an explicit priority
and a stable tiebreak, each tries a bounded list of stagger slots against the occupied rectangles,
anything that still collides is skipped rather than drawn on top, and an explicit per-tier cap bounds
the visible count. There is no force simulation and no work after the first settle. Band labels are
anchored from `bandStart`, `bandThickness`, and `bandGap`, so they sit beside the bars they describe.

The placement box model is direction aware. SVG resolves `text-anchor` `start` and `end` against the
writing direction, not against the left and right edges, so the resolved direction that writes `dir`
on the visual root is passed into placement and the edge-anchored labels — arm captions and scale
annotations — reserve the rectangle the browser will actually paint. Predicting the left-to-right box
under `dir="rtl"` would reserve the mirror image of the painted text, which silently voids both the
no-overlap and the no-escape guarantee for exactly those labels.

Series differentiation never depends on hue alone. The two series fills carry a guaranteed relative
luminance separation, the two series occupy opposite sides of a mirrored axis, and texture is retained
for color-vision accessibility: a rotation-invariant stipple in the normal theme, where a diagonal
hatch read as noise on rotated arms, and the hard diagonal hatch in high contrast. Bars carry rounded
caps, so each band also carries an invisible rectangle that keeps its interactive area exactly the
band rectangle.

Both renderers use the same transform, selection identities, hit-test target keys, focus state,
tooltip content, and accessible descriptions. Canvas is a rendering optimization, not a reduced
semantic mode.

Viewport navigation composes an immutable scene fit with an in-memory `{ zoom, panX, panY }` camera.
Forward and inverse transforms support both ordinary and inverted-Y providers. Camera identity is
derived from provider/mode and ordered geometry, excluding analytical values, focus, periods, and
host selection. The geometry identity excludes Entity bindings, analytical values, detail state,
focus, period, and selection. Binding/style paint has a separate identity. Focus, period, and
selection updates therefore reuse the provider scene and camera.

Fit remains the configured minimum camera zoom. Home is resolved independently: Automatic chooses
Fill for navigable built-in packs, points, and bound geometry, and Fit for grid, hex, or
non-navigable contexts. Fill is calculated from the actual fitted base bounds and padded usable
viewport, then clamped to the configured minimum and maximum. Home placement is resolved separately
from Home zoom: Automatic anchors Home on a bound Entity with loaded detail for built-in packs, whose
complete backdrop can be only partially bound, and keeps the geometric scene centre for generated and
bound scenes, whose bounds already come from the bound Entities. The anchor is the bound candidate
nearest the centroid of all bound candidates, memoised per scene identity and model revision, so
navigation never re-walks the backdrop, and it is null when nothing is bound. Initial load and
Home/reset use that resolved zoom and anchor. An incompatible geometry scene resets; valid resize
preserves the scene point under the old viewport center, while a camera still at Home recomputes the
resized Home view. A later anchor change, such as report data arriving after the backdrop, moves the
camera only while it is still exactly at Home. Every path
retains the bounded clamp, so the scene cannot be lost.

SVG geometry is created once under a camera `<g>`. Canvas rasterizes one bounded, overscanned neutral
base surface and one coordinated color-picking surface/index in base-fit coordinates, then submits a
transformed `drawImage` crop to the bounded display Canvas for each camera update. Screen input is
inverse-transformed before the existing color read, spatial bucket lookup, and geometric fallback.
Focused/selected outlines, connector, center probe, reset control, and help remain in the shared
screen-space SVG/HTML overlay. `RenderedContextSurface.updateDynamic` updates only those overlays and
the bounded semantic window. Canvas may magnify its stable base raster at high zoom; it never
reconstructs county paths or the picking index per camera or probe event. Hidden no-data paint leaves
the complete picking surface and semantic backdrop intact.

Canvas hit testing reads the color-picking pixel before geometry work and performs O(1) feature and
interaction-target lookups. When the picked feature is the highest-rendered candidate in its spatial
bucket, one geometric validation completes the normal path. Otherwise the fallback evaluates every
geometrically possible bucket candidate in reverse render order, bounded by the scene's declared
feature budget rather than a lossy constant cap. The picking buffer uses fills without inflated
strokes, so shared boundaries do not overwrite neighboring interiors.

The spatial index never evicts feature references. It starts with 32-pixel picking buckets and doubles
the bucket size until total references fit the 500,000-reference safety budget. Under the 4,000-feature
scene cap, a single full-surface bucket guarantees a non-lossy bounded construction. This preserves
underlying feature, nested-hole, overlap, saturated-cell, and shared-edge parity without an all-scene
scan on normal pointer moves.

## Detail loading

`auto`, `eager`, `segmented`, and `external` are user-selectable. Auto chooses segmented when the
DataView has a segment marker, otherwise eager. Segmented loading requests at most four segments.
External loading treats report filters as authoritative.

`matrixExpand` remains an internal unavailable interface. Capabilities do not declare
`expandCollapse` or `drilldown`; those remain absent until native host evidence establishes their
behavior.

## Interaction boundary

Context Entity bindings resolve to entity-level matrix identities and profile marks retain bucket-level
identities. The shared controller owns gesture arbitration, tooltip, context-menu, keyboard focus,
and disabled-interaction behavior. One Visual-owned coordinator serializes every profile/context
selection: one host promise at a time, latest single-select coalescing, ordered explicit multi-select,
and queued-work invalidation on external callbacks. An already in-flight host call is not cancellable
and remains an explicit last-writer boundary. A stale successful completion reconciles overlays from
`SelectionManager.getSelectionIds()` while leaving local focus untouched; stale rejection is
diagnostic-only. Report selection is the default entity action. Local-only
mode makes no host mutation. Highlights, RLS, external filters, and external selections remain
read-only host inputs. The visual declares no filter capability and never calls `applyJsonFilter`.

Navigation and activation are separate state transitions. Spatial arrow keys update local entity
focus, the header, and `aria-activedescendant` without mutating host selection or filters. Pointer
click and Enter/Space activate the focused entity according to the configured interaction mode.
The only v1 modes are local focus and host report selection; neither writes an outward filter.

Viewport navigation has migration-safe `auto`, `on`, and `off` modes. Unset/new reports use `auto`,
which activates only for an interactive, non-profile-only scene with multiple features. Persisted
legacy `false`/`true` values resolve to `off`/`on`. A pointer-captured primary drag
owns the gesture after four CSS pixels and consumes its click. Wheel/trackpad zoom uses a non-passive
listener only on the active viewport and one 120 ms settle timeout. Finite nonzero wheel gestures are
contained even when zoom is already clamped; zero/invalid or disabled input is not consumed. One touch
pointer pans. Two touch pointers snapshot the starting camera and scene anchor, then solve zoom plus
midpoint translation from that snapshot and clamp the complete camera once. Returning from two
pointers to one rebases pan without changing the camera. Pointer cancel/lost capture is idempotent.
Wheel settle callbacks carry a generation and are cancelled when pointer/pinch, click, plain spatial
keyboard, keyboard camera/reset, rebind, disabled interaction, or destroy takes ownership. A stale
callback cannot reassert probe focus or commit host selection. External host selection also
suppresses pending wheel and current drag/pinch settle ownership without reverting camera state.
Plain Arrow retains spatial backdrop browsing; Shift+Arrow pans, `+`/`-` zooms, and Home resets.
After every camera mutation, the camera-aware renderer hit-tests the fixed center pixel. A canonical
feature/Entity/detail/period token deduplicates unchanged states. Changed states update only the
focused profile region and dynamic overlay; provider, scene, base geometry/raster, and picking
builders remain untouched.

Probe focus is local during movement. `localOnly` makes no host call. `reportSelection` commits at
most one final directly matched, loaded Entity per current user settle. Programmatic
mount/restore/resize never selects. The serialized coordinator coalesces superseded settle/explicit
single-select intent and surfaces rejection without changing local focus or retrying.

The focus state is explicit: loaded Entity, unbound known feature, bound but unloaded Entity, no
feature, or configured fallback. No-data states clear profile marks/table values. Fallback is an exact
raw bound text Entity, applies only over no feature, is visibly disclosed, and is never selected from
movement settle.

The semantic status and profile table remain available at every responsive size. Feature descriptions,
focus order, selected state, tooltip text, high-contrast cues, RTL, and reduced-motion behavior are
kept equivalent between SVG and Canvas. A dedicated polite live region deduplicates probe-state
announcements with at most one bounded trailing timer.

Resolved theme colors are also published as CSS variables. Navigation help, attribution, reset
control, focus outlines, context background, and disabled chrome use the host high-contrast
foreground/background/selected palette rather than fixed light-theme colors.

When host interactions are disabled, camera listeners, capture, wheel prevention, controls, focus
chrome, tooltip resolution during gestures, and every host call are disabled. The current camera is
rendered statically. The context remains one semantic Tab stop; the pointer reset button has
`tabindex="-1"` and Home provides the keyboard equivalent.

## Security and proof boundary

Privileges are empty. The implementation has no file access, upload, network calls, `eval`, or
`Function` construction and accepts no executable provider payload.

Unit and packaged-browser checks can prove bounded parsing, deterministic scenes, renderer policy,
interaction calls, real Chromium mouse/wheel behavior, synthetic Pointer Event pinch, camera frame
work, inverse picking, and semantic parity in the test environment. They cannot prove native Desktop
mouse, trackpad, touch, export, or service host behavior. The Desktop checklist is therefore required
for each release candidate.
Certification is not claimed.
