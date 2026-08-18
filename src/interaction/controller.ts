import powerbi from "powerbi-visuals-api";

type ISelectionId = powerbi.extensibility.ISelectionId;
type ISelectionManager = powerbi.extensibility.ISelectionManager;
type ITooltipService = powerbi.extensibility.ITooltipService;
type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

export interface InteractionTarget {
    readonly key: string;
    readonly element: Element;
    readonly identity: ISelectionId | null;
    readonly tooltip: () => readonly VisualTooltipDataItem[];
}

export interface ControllerDependencies {
    readonly root: HTMLElement;
    readonly selectionManager: ISelectionManager;
    readonly tooltipService: ITooltipService;
    readonly emptySelectionId: ISelectionId | null;
    readonly onSelectionChanged: () => void;
    readonly onFocusChanged: (key: string | null) => void;
}

/**
 * Owns every host mutating gesture.
 *
 * Two invariants matter here: exactly one host call per gesture (one context menu invocation, one
 * tooltip lifecycle), and a hard stop when the host disables interactions. When interactions are
 * disabled the DOM is still rendered and still described, but no selection, tooltip or context
 * menu call is made.
 */
export class InteractionController {
    private allowInteractions = true;
    private targets: readonly InteractionTarget[] = [];
    private orderedKeys: readonly string[] = [];
    private focusKey: string | null = null;
    private tooltipKey: string | null = null;
    private tooltipIsTouch = false;
    private readonly listeners: Array<() => void> = [];
    private rootContextMenuAttached = false;

    public constructor(private readonly deps: ControllerDependencies) {}

    public setAllowInteractions(allow: boolean): void {
        this.allowInteractions = allow;
        if (!allow) {
            this.hideTooltip();
        }
    }

    public get currentFocusKey(): string | null {
        return this.focusKey;
    }

    public setFocusKey(key: string | null): void {
        this.focusKey = key;
    }

    public bind(targets: readonly InteractionTarget[]): void {
        this.detachTargetListeners();
        this.targets = targets;
        this.orderedKeys = targets.map((target) => target.key);
        if (this.focusKey === null || !this.orderedKeys.includes(this.focusKey)) {
            this.focusKey = this.orderedKeys[0] ?? null;
        }
        for (const target of targets) {
            target.element.setAttribute(
                "tabindex",
                this.allowInteractions && target.key === this.focusKey ? "0" : "-1"
            );
            this.attachTarget(target);
        }
        this.attachRootContextMenu();
    }

    /** Restores keyboard focus to the stable target key after a rerender. */
    public restoreFocus(hadFocus: boolean): void {
        if (!hadFocus || this.focusKey === null) {
            return;
        }
        const target = this.targets.find((entry) => entry.key === this.focusKey);
        if (target && target.element instanceof HTMLElement) {
            target.element.focus();
            return;
        }
        if (target) {
            (target.element as unknown as { focus?: () => void }).focus?.();
        }
    }

    public dispose(): void {
        this.hideTooltip();
        this.detachTargetListeners();
    }

    private attachTarget(target: InteractionTarget): void {
        const element = target.element;

        this.on(element, "click", (event) => {
            const pointer = event as MouseEvent;
            pointer.stopPropagation();
            if (!this.allowInteractions) {
                return;
            }
            this.focus(target.key);
            if (!target.identity) {
                return;
            }
            void this.deps.selectionManager
                .select(target.identity, Boolean(pointer.ctrlKey || pointer.metaKey || pointer.shiftKey))
                .then(() => this.deps.onSelectionChanged());
        });

        this.on(element, "pointerover", (event) => {
            this.showTooltip(target, event as PointerEvent);
        });
        this.on(element, "pointermove", (event) => {
            this.moveTooltip(target, event as PointerEvent);
        });
        this.on(element, "pointerout", () => {
            this.hideTooltip();
        });

        this.on(element, "contextmenu", (event) => {
            const pointer = event as MouseEvent;
            pointer.preventDefault();
            pointer.stopPropagation();
            if (!this.allowInteractions) {
                return;
            }
            this.hideTooltip();
            void this.deps.selectionManager.showContextMenu(
                target.identity ?? this.deps.emptySelectionId ?? ({} as ISelectionId),
                { x: pointer.clientX ?? 0, y: pointer.clientY ?? 0 }
            );
        });

        this.on(element, "focus", () => {
            this.focus(target.key);
        });

        this.on(element, "keydown", (event) => {
            this.handleKeyDown(target, event as KeyboardEvent);
        });
    }

    private handleKeyDown(target: InteractionTarget, event: KeyboardEvent): void {
        if (!this.allowInteractions) {
            return;
        }
        const index = this.orderedKeys.indexOf(target.key);
        if (index < 0) {
            return;
        }
        switch (event.key) {
            case "ArrowRight":
            case "ArrowDown":
                event.preventDefault();
                this.moveFocus(index + 1);
                break;
            case "ArrowLeft":
            case "ArrowUp":
                event.preventDefault();
                this.moveFocus(index - 1);
                break;
            case "Home":
                event.preventDefault();
                this.moveFocus(0);
                break;
            case "End":
                event.preventDefault();
                this.moveFocus(this.orderedKeys.length - 1);
                break;
            case "Enter":
            case " ":
                event.preventDefault();
                if (this.allowInteractions && target.identity) {
                    void this.deps.selectionManager
                        .select(target.identity, Boolean(event.ctrlKey || event.metaKey))
                        .then(() => this.deps.onSelectionChanged());
                }
                break;
            case "Escape":
                event.preventDefault();
                this.hideTooltip();
                this.deps.root.focus();
                break;
            default:
                break;
        }
    }

    private moveFocus(nextIndex: number): void {
        if (this.orderedKeys.length === 0) {
            return;
        }
        const clamped = Math.min(Math.max(nextIndex, 0), this.orderedKeys.length - 1);
        const key = this.orderedKeys[clamped];
        this.focus(key);
        const target = this.targets.find((entry) => entry.key === key);
        (target?.element as unknown as { focus?: () => void } | undefined)?.focus?.();
    }

    private focus(key: string): void {
        if (this.focusKey === key) {
            return;
        }
        this.focusKey = key;
        for (const target of this.targets) {
            target.element.setAttribute("tabindex", target.key === key ? "0" : "-1");
        }
        this.deps.onFocusChanged(key);
    }

    private attachRootContextMenu(): void {
        if (this.rootContextMenuAttached) {
            return;
        }
        this.rootContextMenuAttached = true;
        this.deps.root.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            if (!this.allowInteractions) {
                return;
            }
            this.hideTooltip();
            void this.deps.selectionManager.showContextMenu(
                this.deps.emptySelectionId ?? ({} as ISelectionId),
                { x: event.clientX ?? 0, y: event.clientY ?? 0 }
            );
        });
    }

    private showTooltip(target: InteractionTarget, event: PointerEvent): void {
        if (!this.allowInteractions || !this.deps.tooltipService.enabled()) {
            return;
        }
        if (this.tooltipKey === target.key) {
            this.moveTooltip(target, event);
            return;
        }
        this.tooltipKey = target.key;
        this.tooltipIsTouch = event.pointerType === "touch";
        this.deps.tooltipService.show({
            coordinates: [event.clientX ?? 0, event.clientY ?? 0],
            isTouchEvent: this.tooltipIsTouch,
            dataItems: [...target.tooltip()],
            identities: target.identity ? [target.identity] : []
        });
    }

    private moveTooltip(target: InteractionTarget, event: PointerEvent): void {
        if (!this.allowInteractions || this.tooltipKey === null) {
            return;
        }
        if (!this.deps.tooltipService.enabled()) {
            return;
        }
        this.deps.tooltipService.move({
            coordinates: [event.clientX ?? 0, event.clientY ?? 0],
            isTouchEvent: this.tooltipIsTouch,
            identities: target.identity ? [target.identity] : []
        });
    }

    public hideTooltip(): void {
        if (this.tooltipKey === null) {
            return;
        }
        this.tooltipKey = null;
        this.deps.tooltipService.hide({
            immediately: this.tooltipIsTouch,
            isTouchEvent: this.tooltipIsTouch
        });
        this.tooltipIsTouch = false;
    }

    private on(element: Element, type: string, handler: (event: Event) => void): void {
        element.addEventListener(type, handler);
        this.listeners.push(() => element.removeEventListener(type, handler));
    }

    private detachTargetListeners(): void {
        while (this.listeners.length > 0) {
            const remove = this.listeners.pop();
            remove?.();
        }
    }
}
