# Partner Center testing instructions

Paste the following text into **Properties > Notes for certification** for Atlyn Profile Lens. Do
not leave that required field empty.

> Atlyn Profile Lens 1.9.1.2 is an offline Power BI custom visual. It requires no account, license
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
> Upload these exact matching artifacts:
>
> - `atlynProfileLens.1.9.1.2.pbiviz` — 725371 bytes — SHA-256
>   `447c985f36407fd044648605b688e0385ea37612c22cfaece4fa35242bd46c23`
> - `AtlynProfileLensSample.pbix` — 1191138 bytes — SHA-256
>   `af5c8c588592013fe4e03ccfeb0af405bb5f9544a1064d59b09f41c424c01563`
>
> In Power BI Desktop, open `AtlynProfileLensSample.pbix`. The report contains two pages and synthetic
> data only:
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
> The PBIVIZ contains exactly one `atlynProfileLens` payload. The PBIX embeds that exact payload
> (3318289 bytes; SHA-256
> `50139e119669346310e0934cd7acd59cfcdb3fb7b047110053d515922fd75c25`) and has two
> active canonical PBIR references. The package declares empty privileges and makes no external
> requests.

The PBIX was saved and reopened in Power BI Desktop with unchanged bytes. This is artifact/parity and
limited reopen evidence, not a claim of Microsoft certification or completion of every native
checklist item.
