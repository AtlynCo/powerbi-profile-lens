# Samples

`AtlynProfileLensSample` is a generated PBIP project used to exercise the visual offline as a rich Demographics & Community Profile demo.

- Regenerate it with `npm run sample:pbip` after `npm run package`.
- The semantic model is a DAX `DATATABLE` calculated table: no data source, no credentials, no
  refresh, and 180 synthetic rows with demographic metric sets (Population Distribution by Age Band,
  Household Income Brackets, Educational Attainment, Community Health Indicators, Labor Force
  Participation, and Housing & Infrastructure Index). Nothing in it describes real individuals,
  places or private records.
- `AtlynProfileLensSample.Report/CustomVisuals/atlynProfileLens` embeds the exact packaged visual
  resource so the report renders without importing the visual first. `npm run audit:certification`
  fails if that copy no longer matches the current package.
- The state and county pages use the full offline reference hierarchy. County
  lines appear with zoom, fixed-width state/coast outlines remain above fills,
  and all seven non-CONUS insets are framed and labeled. Insets are repositioned
  and rescaled, so distance and area are not comparable.
- No `.pbix` is committed. The separately owner-created PBIX has exact embedded-payload and active
  PBIR resource parity, but no recorded offline reopen or native checklist evidence.
