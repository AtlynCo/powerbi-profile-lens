# Samples

`AtlynProfileLensSample` is a generated PBIP project used to exercise the visual offline.

- Regenerate it with `npm run sample:pbip` after `npm run package`.
- The semantic model is a DAX `DATATABLE` calculated table: no data source, no credentials, no
  refresh, and 60 synthetic rows with deliberately generic labels (`Entity A`, `Band 1`,
  `Metric A`, `Series X`). Nothing in it describes real people, places or businesses.
- `AtlynProfileLensSample.Report/CustomVisuals/atlynProfileLens` embeds the exact packaged visual
  resource so the report renders without importing the visual first. `npm run audit:certification`
  fails if that copy no longer matches the current package.
- No `.pbix` is committed or claimed. Open the `.pbip` in Power BI Desktop and use *Save As* if a
  `.pbix` is needed.
