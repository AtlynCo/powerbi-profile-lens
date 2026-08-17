# Power BI Desktop validation checklist

The automated checks in this repository cannot replace the native host. This checklist is the manual
gate that must pass against the exact release candidate before any submission.

Record the package name and SHA-256 from `dist/release-manifest.json` before starting, and repeat the
checklist if the package is rebuilt.

## 1. Install and field wells

1. Import `dist/atlynProfileLens.<version>.pbiviz` into Power BI Desktop.
2. Drop fields one at a time and confirm each drop is accepted:
   - entity only, then entity + band, then entity + period + band;
   - profile measures added first, before any hierarchy field;
   - series added before and after the profile measures;
   - tooltip fields added at any stage.
3. Confirm the landing page advances through its steps and never blocks a valid drop.
4. Remove fields one at a time and confirm the visual degrades to guidance instead of an error.

## 2. Rendering and layout

1. One, two, three, four, five and six profile measures.
2. `Entity > Band` and `Entity > Period > Band`.
3. Zero, one and two series values, then three or more values to confirm the diagnostic.
4. Resize the tile down to the smallest usable size and confirm nothing escapes the container.
5. Focus mode and Reading Mode.

## 3. Interaction

1. Click a band segment: confirm cross-highlighting in other visuals.
2. Ctrl-click for multi-select, and click empty space to clear.
3. Right-click a segment and right-click empty space: both context menus must appear exactly once.
4. Hover a segment: confirm the native tooltip content and that it follows the pointer.
5. Bind tooltip fields and confirm they appear.
6. Apply a slicer and a cross-filter from another visual and confirm the profile updates.
7. Create a bookmark with a selection, navigate away, and restore it.
8. Disable report interactions for the visual and confirm no selection, tooltip or context menu.

## 4. Data behaviour

1. Blank values, non-numeric values and duplicated band rows produce the documented diagnostics.
2. Each normalization mode matches a hand-computed value from the semantic model.
3. `Sort by column` on the band field controls the band order.
4. A large model (many entities, periods and bands) surfaces bounded counts rather than freezing.
5. Import, DirectQuery and, where available, Direct Lake.

## 5. Future map roles

1. Bind `Context value`, `Latitude`, `Longitude` and `Custom geometry text`.
2. Confirm the profile-only limitation diagnostic appears and no geography is drawn.
3. Confirm invalid coordinates and oversized geometry produce their diagnostics.

## 6. Accessibility

1. Tab into the visual, move with the arrow keys, select with Enter and Space, leave with Escape.
2. Confirm focus returns to the same target after a resize or data refresh.
3. Screen reader: confirm the status message and the profile table are announced.
4. Windows high contrast themes: confirm foreground, background and selected colours are used.
5. A right-to-left report locale.

## 7. Export and persistence

1. Export to PDF and PowerPoint.
2. Pin to a dashboard and confirm the tile renders.
3. Publish to the service and repeat sections 2 and 3 there.
4. Open the PBIP sample in Desktop, use *Save As* to create a `.pbix`, close and reopen it, and
   confirm the visual renders with the same data.

## 8. Record the result

Record, for the exact package hash: the Desktop version, the service tenant, the checklist items
that passed, and any deviation. A failure here invalidates the release candidate; rebuild and rerun
the whole automated gate before repeating this checklist.
