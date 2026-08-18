import powerbi from "powerbi-visuals-api";
import {
    KEYBOARD_ZOOM_FACTOR,
    WHEEL_SETTLE_MS,
    dragThresholdExceeded,
    keyboardPanStep,
    normalizeWheelDelta,
    pointerDistance,
    pointerMidpoint,
    wheelZoomFactor
} from "../context/viewport/gestureState";
import type { GesturePointer } from "../context/viewport/gestureState";

type ISelectionId = powerbi.extensibility.ISelectionId;
type ISelectionManager = powerbi.extensibility.ISelectionManager;
type ITooltipService = powerbi.extensibility.ITooltipService;
type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

export interface InteractionTarget {
    readonly key: string;
    readonly element: Element;
    readonly identity: ISelectionId | null;
    readonly tooltip: () => readonly VisualTooltipDataItem[];
    readonly activate?: () => void;
}

export interface SurfaceInteraction {
    readonly element: HTMLElement;
    readonly resolve: (x: number, y: number) => InteractionTarget | null;
    readonly navigate?: (
        currentKey: string | null,
        direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"
    ) => InteractionTarget | null;
    readonly targetForKey?: (key: string | null) => InteractionTarget | null;
    readonly hasKey?: (key: string) => boolean;
    readonly navigation?: SurfaceNavigation;
}

export interface SurfaceNavigation {
    readonly resetElement: HTMLButtonElement;
    readonly wheelSensitivity: number;
    readonly rtl: boolean;
    readonly panBy: (deltaX: number, deltaY: number) => boolean;
    readonly zoomAt: (factor: number, x: number, y: number) => boolean;
    readonly pinchBy: (
        factor: number,
        anchorX: number,
        anchorY: number,
        deltaX: number,
        deltaY: number
    ) => boolean;
    readonly reset: () => boolean;
    readonly moveEnd: () => void;
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
    private readonly gesturePointers = new Map<number, GesturePointer>();
    private gesturePhase: "idle" | "pressed" | "panning" | "pinching" = "idle";
    private gestureStart: GesturePointer | null = null;
    private gestureLast: GesturePointer | null = null;
    private pinchMidpoint: { readonly x: number; readonly y: number } | null = null;
    private pinchDistance = 0;
    private suppressSurfaceClick = false;
    private wheelSettleTimer: ReturnType<typeof setTimeout> | null = null;
    private gestureElement: HTMLElement | null = null;

    public constructor(private readonly deps: ControllerDependencies) {}

    public setAllowInteractions(allow: boolean): void {
        this.allowInteractions = allow;
        if (!allow) {
            this.hideTooltip();
            this.resetGestureState();
            this.clearWheelSettle();
        }
    }

    public get currentFocusKey(): string | null {
        return this.focusKey;
    }

    public setFocusKey(key: string | null): void {
        this.focusKey = key;
    }

    public bind(
        targets: readonly InteractionTarget[],
        surface: SurfaceInteraction | null = null
    ): void {
        this.detachTargetListeners();
        this.targets = targets;
        this.orderedKeys = targets.map((target) => target.key);
        if (
            this.focusKey === null
            || (
                !this.orderedKeys.includes(this.focusKey)
                && !surface?.hasKey?.(this.focusKey)
            )
        ) {
            this.focusKey = this.orderedKeys[0] ?? null;
        }
        for (const target of targets) {
            target.element.setAttribute(
                "tabindex",
                this.allowInteractions && target.key === this.focusKey ? "0" : "-1"
            );
            this.attachTarget(target);
        }
        if (surface) {
            this.attachSurface(surface);
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
        this.resetGestureState();
        this.clearWheelSettle();
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
            if ((pointer.button ?? 0) !== 0) {
                return;
            }
            this.focus(target.key);
            target.activate?.();
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
            if (!this.allowInteractions) {
                this.deps.root.focus();
                return;
            }
            this.focus(target.key);
        });

        this.on(element, "keydown", (event) => {
            this.handleKeyDown(target, event as KeyboardEvent);
        });
    }

    private attachSurface(surface: SurfaceInteraction): void {
        const element = surface.element;
        element.setAttribute("tabindex", this.allowInteractions ? "0" : "-1");
        element.setAttribute("aria-disabled", this.allowInteractions ? "false" : "true");
        if (surface.navigation && this.allowInteractions) {
            element.setAttribute(
                "aria-keyshortcuts",
                "Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown + - Home"
            );
        } else {
            element.removeAttribute("aria-keyshortcuts");
        }

        this.on(element, "pointerdown", (event) => {
            if (!this.allowInteractions) {
                this.deps.root.focus();
                return;
            }
            this.handleSurfacePointerDown(surface, event as PointerEvent);
        });
        this.on(element, "pointerup", (event) => {
            this.handleSurfacePointerEnd(surface, event as PointerEvent, false);
        });
        this.on(element, "pointercancel", (event) => {
            this.handleSurfacePointerEnd(surface, event as PointerEvent, true);
        });
        this.on(element, "lostpointercapture", (event) => {
            this.handleSurfacePointerEnd(surface, event as PointerEvent, true);
        });
        this.on(element, "focus", () => {
            if (!this.allowInteractions) {
                this.deps.root.focus();
                return;
            }
            const target = surface.targetForKey?.(null);
            if (target) {
                this.rememberSurfaceFocus(target.key);
                element.setAttribute("aria-activedescendant", target.key);
            }
        });
        this.on(element, "click", (event) => {
            const pointer = event as MouseEvent;
            pointer.stopPropagation();
            if (this.suppressSurfaceClick) {
                pointer.preventDefault();
                this.suppressSurfaceClick = false;
                return;
            }
            if (!this.allowInteractions) {
                this.deps.root.focus();
                return;
            }
            if ((pointer.button ?? 0) !== 0) {
                return;
            }
            const target = resolveSurfaceTarget(surface, pointer);
            if (!target) {
                return;
            }
            this.focus(target.key, true);
            target.activate?.();
            if (target.identity) {
                void this.deps.selectionManager
                    .select(target.identity, Boolean(pointer.ctrlKey || pointer.metaKey || pointer.shiftKey))
                    .then(() => this.deps.onSelectionChanged());
            }
        });
        this.on(element, "pointermove", (event) => {
            if (!this.allowInteractions) {
                return;
            }
            const pointer = event as PointerEvent;
            if (this.handleSurfacePointerMove(surface, pointer)) {
                return;
            }
            const target = resolveSurfaceTarget(surface, pointer);
            if (!target) {
                this.hideTooltip();
                return;
            }
            this.showTooltip(target, pointer);
        });
        this.on(element, "pointerout", () => this.hideTooltip());
        this.on(element, "contextmenu", (event) => {
            const pointer = event as MouseEvent;
            pointer.preventDefault();
            pointer.stopPropagation();
            if (this.gesturePhase !== "idle") {
                this.hideTooltip();
                return;
            }
            if (!this.allowInteractions) {
                this.deps.root.focus();
                return;
            }
            const target = resolveSurfaceTarget(surface, pointer);
            this.hideTooltip();
            void this.deps.selectionManager.showContextMenu(
                target?.identity ?? this.deps.emptySelectionId ?? ({} as ISelectionId),
                { x: pointer.clientX ?? 0, y: pointer.clientY ?? 0 }
            );
        });
        this.on(element, "keydown", (event) => {
            if (!this.allowInteractions) {
                return;
            }
            const keyboard = event as KeyboardEvent;
            if (surface.navigation && this.handleNavigationKey(surface, keyboard)) {
                return;
            }
            if (
                keyboard.key === "ArrowLeft"
                || keyboard.key === "ArrowRight"
                || keyboard.key === "ArrowUp"
                || keyboard.key === "ArrowDown"
            ) {
                const target = surface.navigate?.(this.focusKey, keyboard.key);
                if (target) {
                    keyboard.preventDefault();
                    this.focus(target.key);
                    element.setAttribute("aria-activedescendant", target.key);
                }
                return;
            }
            if (keyboard.key === "Enter" || keyboard.key === " ") {
                const target = surface.targetForKey?.(this.focusKey);
                if (target) {
                    keyboard.preventDefault();
                    this.focus(target.key, true);
                    target.activate?.();
                    if (target.identity) {
                        void this.deps.selectionManager
                            .select(target.identity, Boolean(keyboard.ctrlKey || keyboard.metaKey))
                            .then(() => this.deps.onSelectionChanged());
                    }
                }
                return;
            }
            if (keyboard.key === "Escape") {
                keyboard.preventDefault();
                this.hideTooltip();
                this.deps.root.focus();
            }
        });
        if (surface.navigation && this.allowInteractions) {
            this.on(element, "wheel", (event) => {
                this.handleSurfaceWheel(surface, event as WheelEvent);
            }, { passive: false });
            this.attachResetControl(surface);
        }
    }

    private handleSurfacePointerDown(
        surface: SurfaceInteraction,
        event: PointerEvent
    ): void {
        const navigation = surface.navigation;
        if (
            !navigation
            || navigation.resetElement.contains(event.target as Node)
            || !Number.isInteger(event.pointerId)
            || this.gesturePointers.size >= 2
        ) {
            return;
        }
        if (this.gesturePhase === "idle" && this.gesturePointers.size === 0) {
            this.suppressSurfaceClick = false;
        }
        const pointerType = event.pointerType || "mouse";
        if (pointerType !== "touch" && event.button !== 0) {
            return;
        }
        if (
            this.gesturePointers.size === 1
            && (
                pointerType !== "touch"
                || [...this.gesturePointers.values()][0]?.pointerType !== "touch"
            )
        ) {
            return;
        }
        const pointer = surfacePointer(surface, event);
        this.gestureElement = surface.element;
        this.gesturePointers.set(pointer.id, pointer);
        if (event.isTrusted && typeof surface.element.setPointerCapture === "function") {
            surface.element.setPointerCapture(event.pointerId);
        }
        if (this.gesturePointers.size === 1) {
            this.gesturePhase = "pressed";
            this.gestureStart = pointer;
            this.gestureLast = pointer;
            return;
        }
        const [first, second] = [...this.gesturePointers.values()];
        this.gesturePhase = "pinching";
        surface.element.classList.add("profile-lens-context-panning");
        this.pinchMidpoint = pointerMidpoint(first, second);
        this.pinchDistance = pointerDistance(first, second);
        this.suppressSurfaceClick = true;
        this.hideTooltip();
        event.preventDefault();
    }

    private handleSurfacePointerMove(
        surface: SurfaceInteraction,
        event: PointerEvent
    ): boolean {
        const navigation = surface.navigation;
        if (!navigation || !this.gesturePointers.has(event.pointerId)) {
            return false;
        }
        const pointer = surfacePointer(surface, event);
        this.gesturePointers.set(pointer.id, pointer);
        if (this.gesturePhase === "pinching") {
            const [first, second] = [...this.gesturePointers.values()];
            if (!first || !second || !this.pinchMidpoint || this.pinchDistance <= 0) {
                return true;
            }
            const midpoint = pointerMidpoint(first, second);
            const distance = pointerDistance(first, second);
            navigation.pinchBy(
                distance / this.pinchDistance,
                this.pinchMidpoint.x,
                this.pinchMidpoint.y,
                midpoint.x - this.pinchMidpoint.x,
                midpoint.y - this.pinchMidpoint.y
            );
            this.pinchMidpoint = midpoint;
            this.pinchDistance = distance;
            this.suppressSurfaceClick = true;
            this.hideTooltip();
            event.preventDefault();
            return true;
        }
        if (!this.gestureStart || !this.gestureLast) {
            return false;
        }
        if (
            this.gesturePhase === "pressed"
            && !dragThresholdExceeded(this.gestureStart, pointer)
        ) {
            return false;
        }
        if (this.gesturePhase === "pressed") {
            this.gesturePhase = "panning";
            surface.element.classList.add("profile-lens-context-panning");
            this.suppressSurfaceClick = true;
            this.hideTooltip();
        }
        if (this.gesturePhase !== "panning") {
            return false;
        }
        navigation.panBy(
            pointer.x - this.gestureLast.x,
            pointer.y - this.gestureLast.y
        );
        this.gestureLast = pointer;
        event.preventDefault();
        return true;
    }

    private handleSurfacePointerEnd(
        surface: SurfaceInteraction,
        event: PointerEvent,
        cancelled: boolean
    ): void {
        if (!this.gesturePointers.has(event.pointerId)) {
            return;
        }
        const moved = this.gesturePhase === "panning" || this.gesturePhase === "pinching";
        this.gesturePointers.delete(event.pointerId);
        if (
            event.isTrusted
            && typeof surface.element.hasPointerCapture === "function"
            && surface.element.hasPointerCapture(event.pointerId)
        ) {
            surface.element.releasePointerCapture(event.pointerId);
        }
        const remaining = [...this.gesturePointers.values()][0];
        if (remaining) {
            this.gesturePhase = moved ? "panning" : "pressed";
            this.gestureStart = remaining;
            this.gestureLast = remaining;
            this.pinchMidpoint = null;
            this.pinchDistance = 0;
            this.suppressSurfaceClick ||= moved || cancelled;
            return;
        }
        if (moved) {
            surface.navigation?.moveEnd();
        }
        this.suppressSurfaceClick ||= moved || cancelled;
        this.resetGestureState(true);
    }

    private handleSurfaceWheel(surface: SurfaceInteraction, event: WheelEvent): void {
        const navigation = surface.navigation;
        if (!navigation || !this.allowInteractions) {
            return;
        }
        const bounds = surface.element.getBoundingClientRect();
        const delta = normalizeWheelDelta(event.deltaY, event.deltaMode, bounds.height);
        if (delta === 0) {
            return;
        }
        const changed = navigation.zoomAt(
            wheelZoomFactor(delta, navigation.wheelSensitivity),
            (event.clientX ?? 0) - bounds.left,
            (event.clientY ?? 0) - bounds.top
        );
        if (!changed) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.hideTooltip();
        this.clearWheelSettle();
        this.wheelSettleTimer = setTimeout(() => {
            this.wheelSettleTimer = null;
            navigation.moveEnd();
        }, WHEEL_SETTLE_MS);
    }

    private handleNavigationKey(
        surface: SurfaceInteraction,
        event: KeyboardEvent
    ): boolean {
        const navigation = surface.navigation;
        if (!navigation || !this.allowInteractions) {
            return false;
        }
        const bounds = surface.element.getBoundingClientRect();
        if (
            event.shiftKey
            && (
                event.key === "ArrowLeft"
                || event.key === "ArrowRight"
                || event.key === "ArrowUp"
                || event.key === "ArrowDown"
            )
        ) {
            const step = keyboardPanStep({ width: bounds.width, height: bounds.height });
            const direction = navigation.rtl && event.key === "ArrowLeft"
                ? "ArrowRight"
                : navigation.rtl && event.key === "ArrowRight"
                    ? "ArrowLeft"
                    : event.key;
            const deltaX = direction === "ArrowLeft" ? step
                : direction === "ArrowRight" ? -step
                    : 0;
            const deltaY = direction === "ArrowUp" ? step
                : direction === "ArrowDown" ? -step
                    : 0;
            if (navigation.panBy(deltaX, deltaY)) {
                navigation.moveEnd();
            }
            event.preventDefault();
            return true;
        }
        const centerX = bounds.width / 2;
        const centerY = bounds.height / 2;
        if (event.key === "+" || event.key === "=" || event.key === "Add") {
            if (navigation.zoomAt(KEYBOARD_ZOOM_FACTOR, centerX, centerY)) {
                navigation.moveEnd();
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "-" || event.key === "_" || event.key === "Subtract") {
            if (navigation.zoomAt(1 / KEYBOARD_ZOOM_FACTOR, centerX, centerY)) {
                navigation.moveEnd();
            }
            event.preventDefault();
            return true;
        }
        if (event.key === "Home") {
            if (navigation.reset()) {
                navigation.moveEnd();
            }
            event.preventDefault();
            return true;
        }
        return false;
    }

    private attachResetControl(surface: SurfaceInteraction): void {
        const reset = surface.navigation?.resetElement;
        if (!reset) {
            return;
        }
        this.on(reset, "pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        this.on(reset, "click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!this.allowInteractions) {
                this.deps.root.focus();
                return;
            }
            if (surface.navigation?.reset()) {
                surface.navigation.moveEnd();
            }
            surface.element.focus();
        });
        this.on(reset, "contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
    }

    private resetGestureState(preserveSuppression = false): void {
        const element = this.gestureElement;
        const pointerIds = [...this.gesturePointers.keys()];
        this.gesturePointers.clear();
        element?.classList.remove("profile-lens-context-panning");
        if (element && typeof element.hasPointerCapture === "function") {
            for (const pointerId of pointerIds) {
                if (element.hasPointerCapture(pointerId)) {
                    element.releasePointerCapture(pointerId);
                }
            }
        }
        this.gestureElement = null;
        this.gesturePhase = "idle";
        this.gestureStart = null;
        this.gestureLast = null;
        this.pinchMidpoint = null;
        this.pinchDistance = 0;
        if (!preserveSuppression) {
            this.suppressSurfaceClick = false;
        }
    }

    private clearWheelSettle(): void {
        if (this.wheelSettleTimer === null) {
            return;
        }
        clearTimeout(this.wheelSettleTimer);
        this.wheelSettleTimer = null;
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
                    target.activate?.();
                    void this.deps.selectionManager
                        .select(target.identity, Boolean(event.ctrlKey || event.metaKey))
                        .then(() => this.deps.onSelectionChanged());
                }
                if (this.allowInteractions && !target.identity) {
                    target.activate?.();
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

    private focus(key: string, forceChange = false): void {
        if (!this.allowInteractions) {
            return;
        }
        if (this.focusKey === key && !forceChange) {
            return;
        }
        this.focusKey = key;
        for (const target of this.targets) {
            target.element.setAttribute("tabindex", target.key === key ? "0" : "-1");
        }
        this.deps.onFocusChanged(key);
    }

    private rememberSurfaceFocus(key: string): void {
        this.focusKey = key;
        for (const target of this.targets) {
            target.element.setAttribute("tabindex", "-1");
        }
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

    private on(
        element: Element,
        type: string,
        handler: (event: Event) => void,
        options?: AddEventListenerOptions
    ): void {
        element.addEventListener(type, handler, options);
        this.listeners.push(() => element.removeEventListener(type, handler, options));
    }

    private detachTargetListeners(): void {
        this.resetGestureState();
        this.clearWheelSettle();
        while (this.listeners.length > 0) {
            const remove = this.listeners.pop();
            remove?.();
        }
    }

}

function resolveSurfaceTarget(
    surface: SurfaceInteraction,
    event: MouseEvent | PointerEvent
): InteractionTarget | null {
    const bounds = surface.element.getBoundingClientRect();
    return surface.resolve(
        (event.clientX ?? 0) - bounds.left,
        (event.clientY ?? 0) - bounds.top
    );
}

function surfacePointer(
    surface: SurfaceInteraction,
    event: PointerEvent
): GesturePointer {
    const bounds = surface.element.getBoundingClientRect();
    return {
        id: event.pointerId,
        x: (event.clientX ?? 0) - bounds.left,
        y: (event.clientY ?? 0) - bounds.top,
        pointerType: event.pointerType || "mouse"
    };
}
