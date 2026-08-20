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
- No `.pbix` is committed or claimed. Open the `.pbip` in Power BI Desktop and use *Save As* if a
  `.pbix` is needed.

