import { Diagnostic, ProfileDataModel } from "../model/contract";
import { Localization, ResourceKey } from "../localization";

export interface StatusInput {
    readonly model: ProfileDataModel;
    readonly localization: Localization;
    readonly showDiagnostics: boolean;
    readonly showCounts: boolean;
    readonly summary: string;
    readonly busy: boolean;
}

/**
 * Renders the polite live status and the diagnostic list.
 *
 * Diagnostics are never collapsed into a generic failure: every code has its own localized message
 * and, where relevant, the received/retained/rejected counts that justify it.
 */
export function renderStatus(container: HTMLElement, input: StatusInput): void {
    clear(container);
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-busy", input.busy ? "true" : "false");

    const summary = document.createElement("p");
    summary.className = "profile-lens-status-summary";
    summary.textContent = input.busy
        ? `${input.localization.get("Status_Rendering")}: ${input.summary}`
        : input.summary;
    container.appendChild(summary);

    if (!input.showDiagnostics || input.model.diagnostics.length === 0) {
        return;
    }

    const list = document.createElement("ul");
    list.className = "profile-lens-diagnostics";
    for (const diagnostic of input.model.diagnostics) {
        const item = document.createElement("li");
        item.className = `profile-lens-diagnostic profile-lens-${diagnostic.severity}`;
        item.setAttribute("data-code", diagnostic.code);
        item.textContent = describe(diagnostic, input.localization);
        list.appendChild(item);
    }
    container.appendChild(list);

    if (input.showCounts) {
        const counts = document.createElement("p");
        counts.className = "profile-lens-counts";
        counts.textContent = [
            `received ${input.model.counts.received}`,
            `retained ${input.model.counts.retained}`,
            `missing ${input.model.counts.missing}`,
            `non numeric ${input.model.counts.nonNumeric}`,
            `non finite ${input.model.counts.nonFinite}`,
            `duplicate ${input.model.counts.duplicate}`,
            `over limit ${input.model.counts.overLimit}`,
            `segments ${input.model.segments.requests}/${input.model.segments.maxRequests}`
        ].join(", ");
        container.appendChild(counts);
    }
}

export function describe(diagnostic: Diagnostic, localization: Localization): string {
    const key = diagnostic.messageKey as ResourceKey;
    const values: (string | number)[] = [];
    switch (diagnostic.code) {
        case "extensionRolesProfileOnly":
            values.push(diagnostic.detail ?? "");
            break;
        case "oversizedGeometry":
            values.push(diagnostic.rejected ?? 0, diagnostic.detail ?? "");
            break;
        case "duplicateCells":
        case "blankValues":
        case "nonNumericValues":
        case "nonFiniteValues":
        case "negativeProfileValues":
        case "zeroDenominator":
        case "invalidCoordinates":
        case "conflictingCoordinates":
        case "incompleteCoordinates":
        case "emptyGeometry":
        case "nonFiniteContextValue":
            values.push(diagnostic.rejected ?? 0);
            break;
        case "hierarchyDepthUnsupported":
            values.push(diagnostic.received ?? 0);
            break;
        default:
            values.push(diagnostic.received ?? 0, diagnostic.retained ?? 0);
            break;
    }
    return localization.format(key, ...values);
}

function clear(node: Element): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}
