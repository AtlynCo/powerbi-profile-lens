import { AuthoringStage, ProfileDataModel } from "../model/contract";
import { Localization, ResourceKey } from "../localization";

export interface LandingInput {
    readonly stage: AuthoringStage;
    readonly model: ProfileDataModel;
    readonly localization: Localization;
}

const STEP_KEYS: readonly ResourceKey[] = [
    "Landing_Step_Entity",
    "Landing_Step_Period",
    "Landing_Step_Band",
    "Landing_Step_Profile",
    "Landing_Step_Optional"
];

/**
 * Progressive landing guidance. The completed steps are marked as done rather than removed, so the
 * author can see which part of the contract is still missing at every assignment stage.
 */
export function renderLanding(container: HTMLElement, input: LandingInput): void {
    clear(container);
    container.className = "profile-lens-landing";
    container.setAttribute("data-stage", input.stage);

    const heading = document.createElement("h2");
    heading.textContent = input.localization.get("Landing_Title");
    container.appendChild(heading);

    const subtitle = document.createElement("p");
    subtitle.textContent = input.localization.get("Landing_Subtitle");
    container.appendChild(subtitle);

    const steps = document.createElement("ol");
    steps.className = "profile-lens-landing-steps";
    const completed = completedSteps(input.stage, input.model);
    STEP_KEYS.forEach((key, index) => {
        const item = document.createElement("li");
        item.textContent = input.localization.get(key);
        item.setAttribute("data-complete", completed > index ? "true" : "false");
        steps.appendChild(item);
    });
    container.appendChild(steps);

    const profileOnly = document.createElement("p");
    profileOnly.className = "profile-lens-landing-note";
    profileOnly.textContent = input.localization.get("Landing_Note_ProfileOnly");
    container.appendChild(profileOnly);

    const dataSource = document.createElement("p");
    dataSource.className = "profile-lens-landing-note";
    dataSource.textContent = input.localization.get("Landing_Note_DataSource");
    container.appendChild(dataSource);
}

function completedSteps(stage: AuthoringStage, model: ProfileDataModel): number {
    switch (stage) {
        case "empty":
            return 0;
        case "needsEntity":
            return 0;
        case "needsBand":
            return model.hierarchy.hasPeriodLevel ? 2 : 1;
        case "needsProfile":
            return model.hierarchy.hasPeriodLevel ? 3 : 3;
        default:
            return STEP_KEYS.length;
    }
}

function clear(node: Element): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}
