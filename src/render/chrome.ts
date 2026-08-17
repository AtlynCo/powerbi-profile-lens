import { IMPLICIT_INDEX, ProfileDataModel } from "../model/contract";
import { Localization } from "../localization";
import { ResolvedSettings } from "../formatting";
import { Theme, seriesColor } from "./theme";

export interface HeaderInput {
    readonly model: ProfileDataModel;
    readonly settings: ResolvedSettings;
    readonly localization: Localization;
    readonly entityIndex: number;
    readonly periodIndex: number;
}

export function renderHeader(container: HTMLElement, input: HeaderInput): void {
    clear(container);
    container.className = "profile-lens-header";
    if (!input.settings.showHeader) {
        container.setAttribute("hidden", "hidden");
        return;
    }
    container.removeAttribute("hidden");

    const entity = input.model.entities[input.entityIndex];
    const title = document.createElement("h1");
    title.className = "profile-lens-header-title";
    title.style.fontSize = `${input.settings.headerFontSize}px`;
    title.textContent = entity?.label ?? "";
    container.appendChild(title);

    const details: string[] = [];
    if (input.settings.showEntityKey && entity) {
        details.push(entity.key);
    }
    const periods = input.model.periodsByEntity.get(input.entityIndex) ?? [];
    if (input.periodIndex !== IMPLICIT_INDEX && periods[input.periodIndex]) {
        details.push(`${input.localization.get("Header_Period")}: ${periods[input.periodIndex].label}`);
    }
    if (input.settings.showContextValue) {
        const context = input.model.extension.contextValues
            .find((entry) => entry.entityIndex === input.entityIndex);
        if (context) {
            details.push(
                `${input.localization.get("Header_ContextValue")}: ${input.localization.formatNumber(context.value)}`
            );
        }
    }
    if (details.length > 0) {
        const subtitle = document.createElement("p");
        subtitle.className = "profile-lens-header-subtitle";
        subtitle.textContent = details.join(" \u00b7 ");
        container.appendChild(subtitle);
    }
}

export interface LegendInput {
    readonly model: ProfileDataModel;
    readonly theme: Theme;
    readonly localization: Localization;
    readonly visible: boolean;
}

export function renderLegend(container: HTMLElement, input: LegendInput): void {
    clear(container);
    container.className = "profile-lens-legend";
    if (!input.visible || input.model.series.length === 0) {
        container.setAttribute("hidden", "hidden");
        return;
    }
    container.removeAttribute("hidden");
    container.setAttribute("role", "list");
    container.setAttribute("aria-label", input.localization.get("Legend_Label"));

    for (const series of input.model.series) {
        const item = document.createElement("span");
        item.className = "profile-lens-legend-item";
        item.setAttribute("role", "listitem");
        const swatch = document.createElement("span");
        swatch.className = "profile-lens-legend-swatch";
        swatch.style.backgroundColor = seriesColor(input.theme, series.index);
        swatch.style.borderStyle = series.index === 1 ? "dashed" : "solid";
        swatch.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = series.label;
        item.appendChild(swatch);
        item.appendChild(label);
        container.appendChild(item);
    }
}

export interface EntityListInput {
    readonly model: ProfileDataModel;
    readonly localization: Localization;
    readonly entityIndex: number;
    readonly visible: boolean;
    readonly interactive: boolean;
}

export interface EntityOption {
    readonly index: number;
    readonly element: HTMLElement;
}

export function renderEntityList(
    container: HTMLElement,
    input: EntityListInput
): readonly EntityOption[] {
    clear(container);
    container.className = "profile-lens-entities";
    if (!input.visible) {
        container.setAttribute("hidden", "hidden");
        return [];
    }
    container.removeAttribute("hidden");

    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", input.localization.get("EntityList_Label"));
    list.className = "profile-lens-entity-listbox";

    const options: EntityOption[] = [];
    if (input.model.entities.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = input.localization.get("EntityList_Empty");
        container.appendChild(empty);
        return options;
    }

    for (const entity of input.model.entities) {
        const option = document.createElement("div");
        option.className = "profile-lens-entity-option";
        option.setAttribute("role", "option");
        option.setAttribute("data-entity-index", String(entity.index));
        option.setAttribute("aria-selected", entity.index === input.entityIndex ? "true" : "false");
        option.setAttribute("tabindex", entity.index === input.entityIndex ? "0" : "-1");
        option.textContent = entity.label;
        if (!input.interactive) {
            option.setAttribute("aria-disabled", "true");
        }
        list.appendChild(option);
        options.push({ index: entity.index, element: option });
    }
    container.appendChild(list);
    return options;
}

export interface PeriodControlInput {
    readonly model: ProfileDataModel;
    readonly localization: Localization;
    readonly entityIndex: number;
    readonly periodIndex: number;
    readonly visible: boolean;
    readonly interactive: boolean;
}

export interface PeriodControl {
    readonly slider: HTMLElement | null;
    readonly periodCount: number;
}

export function renderPeriodControl(
    container: HTMLElement,
    input: PeriodControlInput
): PeriodControl {
    clear(container);
    container.className = "profile-lens-period";
    const periods = input.model.periodsByEntity.get(input.entityIndex) ?? [];
    if (!input.visible || periods.length === 0) {
        container.setAttribute("hidden", "hidden");
        return { slider: null, periodCount: periods.length };
    }
    container.removeAttribute("hidden");

    const current = periods[Math.max(input.periodIndex, 0)];
    const slider = document.createElement("div");
    slider.className = "profile-lens-period-slider";
    slider.setAttribute("role", "slider");
    slider.setAttribute("tabindex", input.interactive ? "0" : "-1");
    slider.setAttribute("aria-label", input.localization.get("Period_Label"));
    slider.setAttribute("aria-valuemin", "1");
    slider.setAttribute("aria-valuemax", String(periods.length));
    slider.setAttribute("aria-valuenow", String(Math.max(input.periodIndex, 0) + 1));
    slider.setAttribute("aria-valuetext", current?.label ?? "");
    if (!input.interactive) {
        slider.setAttribute("aria-disabled", "true");
    }

    const label = document.createElement("span");
    label.className = "profile-lens-period-label";
    label.textContent = `${input.localization.get("Period_Label")}: ${current?.label ?? ""}`;
    slider.appendChild(label);
    container.appendChild(slider);
    return { slider, periodCount: periods.length };
}

function clear(node: Element): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}
