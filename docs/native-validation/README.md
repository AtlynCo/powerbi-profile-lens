# Native validation evidence

`atlynProfileLens-1.2.0.0.*` is a historical blocked record only. It is not current fixture,
automation, package, or release evidence.

Atlyn Profile Lens 1.9.1.2 has no completed guarded native evidence record. The owner manually
created `dist/release/AtlynProfileLensSample-1.9.1.2.pbix` from the focused PBIP in Power BI
Desktop. It is 1191163 bytes with SHA-256
`d3e60d8b006f56d43e2b9cdbf101ede5dfb9b82448681c281d007b3db2d4e2bd`. Automated read-only
inspection verified the exact 1.9.1.2 packaged payload and resolved both active PBIR references.
On 2026-08-27 the owner confirmed closing and reopening that exact PBIX offline and checking the
World lens, county graph updates, and complete-map panning. These are limited owner observations,
not a completed full native checklist or an automated native run.

The previous Partner Center submission failed because Microsoft could not access the repository. Its
older package, PBIX, and listing were OSM-enabled and must be replaced. No certification claim is
made here. The final owner handoff requires the exact source commit, deterministic PBIVIZ hash,
genuine Power BI Desktop Save As/reopen PBIX hash, and truthful automated/native notes; if the
pattern-gated UI Automation harness cannot complete Save As, the owner must perform that step
manually without editing PBIX internals or fabricating evidence.

The attempted Desktop 2.157.879.0 (26.08) run reached the owned Save As dialog and stopped with
`The owned Save As dialog exposes no safe bound Pane control for ''`; controls `1001` (file name)
and `1` (Save) had no safe ValuePattern/InvokePattern. The exact owner-manual fallback is to open
the generated PBIP, import `dist\atlynProfileLens.1.9.1.2.pbiviz`, use **File > Save as** to write
`dist\release\AtlynProfileLensSample-1.9.1.2.pbix`, close and reopen it offline, then record its
hash and embedded-resource parity. The owner completed that fallback on 2026-08-27. The result is
identified above as owner evidence and was not substituted with SendKeys, coordinate input, Win32
messages, or PBIX edits.
