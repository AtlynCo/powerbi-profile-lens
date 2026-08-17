import { IMPLICIT_INDEX, ProfileDataModel } from "../model/contract";
import { NormalizedFrame, formatDisplayValue } from "../model/normalization";
import { Localization } from "../localization";

export interface TableInput {
    readonly model: ProfileDataModel;
    readonly frame: NormalizedFrame;
    readonly localization: Localization;
    readonly entityIndex: number;
    readonly periodIndex: number;
    readonly visible: boolean;
}

/**
 * Renders the semantic profile table: rows are Bands, columns are Profile x Series, and every cell
 * carries both the displayed and the raw value. The table stays in the accessibility tree even when
 * it is visually hidden, so the chart is never the only representation of the data.
 */
export function renderAccessibleTable(container: HTMLElement, input: TableInput): HTMLTableElement {
    clear(container);
    container.className = input.visible
        ? "profile-lens-table profile-lens-table-visible"
        : "profile-lens-table profile-lens-table-sr";

    const table = document.createElement("table");
    const caption = document.createElement("caption");
    const entity = input.model.entities[input.entityIndex];
    const period = input.periodIndex === IMPLICIT_INDEX
        ? ""
        : input.localization.format(
            "Table_PeriodSuffix",
            (input.model.periodsByEntity.get(input.entityIndex) ?? [])[input.periodIndex]?.label ?? ""
        );
    caption.textContent = input.localization.format(
        "Table_Caption",
        entity?.label ?? "",
        period
    );
    table.appendChild(caption);

    const seriesList = input.model.series.length > 0
        ? input.model.series
        : [{
            index: IMPLICIT_INDEX,
            key: "single",
            label: input.localization.get("Legend_SingleSeries")
        }];

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.appendChild(headerCell(input.localization.get("Table_Band"), "col"));
    for (const profile of input.model.profiles) {
        for (const series of seriesList) {
            const label = seriesList.length > 1
                ? `${profile.label} - ${series.label}`
                : profile.label;
            headRow.appendChild(headerCell(label, "col"));
        }
    }
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    for (const band of input.model.bands) {
        const row = document.createElement("tr");
        row.appendChild(headerCell(band.label, "row"));
        for (const profile of input.model.profiles) {
            for (const series of seriesList) {
                const cell = input.frame.profiles
                    .find((entry) => entry.profileIndex === profile.index)
                    ?.cells.find(
                        (entry) => entry.bandIndex === band.index && entry.seriesIndex === series.index
                    );
                const dataCell = document.createElement("td");
                if (!cell || cell.state === "missing") {
                    dataCell.textContent = input.localization.get("Table_Missing");
                } else if (cell.state === "zeroDenominator") {
                    dataCell.textContent = input.localization.get("Table_ZeroDenominator");
                } else {
                    const displayed = formatDisplayValue(
                        cell.display,
                        input.frame.mode,
                        input.localization.currentLocale
                    );
                    const raw = cell.raw === null ? "" : input.localization.formatNumber(cell.raw);
                    dataCell.textContent = input.frame.mode === "raw"
                        ? raw
                        : `${input.localization.get("Table_Displayed")} ${displayed}, `
                        + `${input.localization.get("Table_Raw")} ${raw}`;
                }
                row.appendChild(dataCell);
            }
        }
        body.appendChild(row);
    }
    table.appendChild(body);
    container.appendChild(table);
    return table;
}

function headerCell(label: string, scope: "row" | "col"): HTMLTableCellElement {
    const cell = document.createElement("th");
    cell.scope = scope;
    cell.textContent = label;
    return cell;
}

function clear(node: Element): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}
