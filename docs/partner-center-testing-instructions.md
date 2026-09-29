# Partner Center testing instructions

Candidate template for a future 1.9.1.3 corrective submission. Version 1.9.1.2 was published after
certification passed with notes; do not replace it unless Microsoft requests the next submission.
Replace the PBIX placeholder only after a matching 1.9.1.3 PBIX has been created and parity-validated.

> Atlyn Profile Lens 1.9.1.3 is an offline Power BI custom visual. It requires no account, license
> key, credentials, subscription check, in-app purchase, gateway, data source, or network access.
>
> Public source: https://github.com/AtlynCo/powerbi-profile-lens
>
> Exact lowercase certification source:
> https://github.com/AtlynCo/powerbi-profile-lens/tree/certification
>
> Product-specific privacy statement:
> https://github.com/AtlynCo/powerbi-profile-lens/blob/certification/PRIVACY.md
>
> Upload the exact matching 1.9.1.3 artifacts recorded by the release validation:
>
> - `atlynProfileLens.1.9.1.3.pbiviz` — 725387 bytes — SHA-256
>   `95376bade4423d9f022419945389554cff049ac082da51165a9f2c2a4d36d724`
> - matching 1.9.1.3 PBIX — record validated bytes and SHA-256
>
> In Power BI Desktop, open `AtlynProfileLensSample.pbix`. The report contains two pages, synthetic
> data only, and a visible Hints & tips banner at the top of each page:
>
> 1. On **World Lens**, confirm the profile chart is populated. Drag the map so another country moves
>    under the fixed center probe; the focused place and profile chart update. Use the Home/reset
>    control to return to the data-bearing home view.
> 2. On **USA Counties**, drag the map so another county moves under the fixed center probe; the
>    county title and profile chart update. Zoom and pan at the minimum zoom to confirm every map edge
>    can reach the probe, then use Home/reset.
> 3. Add a new Atlyn Profile Lens visual to a blank report page. Bind **Entity**, **Series**, and
>    **Profiles** fields. Optional context roles are **Context Value**, **Latitude**, **Longitude**,
>    **Geometry**, and **Tooltips**. The visual presents an instructional empty state while required
>    profile bindings are incomplete.
>
> The PBIVIZ contains exactly one `atlynProfileLens` payload (3318314 bytes; SHA-256
> `bda677602bee6649dca7bb25fe19e556a028c7e398c64534f3075ed04c93a676`). The PBIX must
> embed that exact payload and have two active canonical PBIR references. The package declares empty
> privileges and makes no external requests.

No matching 1.9.1.3 PBIX or native evidence exists yet. Do not submit this template until the
candidate has a genuine Desktop-created PBIX with verified resource parity. This repository does not
claim Microsoft certification or completion of the native checklist.
