# Native validation evidence

`atlynProfileLens-1.2.0.0.*` is a historical blocked record only. It is not current fixture,
automation, package, or release evidence.

Atlyn Profile Lens 1.9.1.2 has no completed guarded native evidence record or matching current PBIX.
The owner-created 1191163-byte PBIX with SHA-256
`d3e60d8b006f56d43e2b9cdbf101ede5dfb9b82448681c281d007b3db2d4e2bd` passed exact parity and a
limited owner-confirmed offline reopen on 2026-08-27, but it embeds the package from before the
Home-boundary correction. It is retained only as a stale historical artifact and must not be used for
submission. A new Save As/reopen from the updated focused PBIP is required.

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
hash and embedded-resource parity. The owner completed that fallback on 2026-08-27 for the now-stale
package. The result is identified above as historical owner evidence and was not substituted with
SendKeys, coordinate input, Win32 messages, or PBIX edits.
