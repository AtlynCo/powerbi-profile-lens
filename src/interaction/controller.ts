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
import type { ContextPinchSnapshot } from "../context/viewport/contract";

type ISelectionId = powerbi.extensibility.ISelectionId;
type ISelectionManager = powerbi.extensibility.ISelectionManager;
type ITooltipService = powerbi.extensibility.ITooltipService;
type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

export type InteractionFocusSource = "pointer" | "keyboard" | "focus";

export interface InteractionActivation {
    readonly source: "pointer" | "keyboard";
    readonly multiSelect: boolean;
}

export interface InteractionTarget {
    readonly key: string;
    readonly element: Element;
    readonly identity: ISelectionId | null;
    readonly tooltip: () => readonly VisualTooltipDataItem[];
    readonly activate?: (activation: InteractionActivation) => void;
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
    readonly beginPinch: (midpointX: number, midpointY: number) =>
        ContextPinchSnapshot | null;
    readonly pinchTo: (
        snapshot: ContextPinchSnapshot,
        distanceRatio: number,
        midpointX: number,
        midpointY: number
    ) => boolean;
    readonly reset: () => boolean;
    readonly moveEnd: (cancelled?: boolean, clickExpected?: boolean) => void;
}

export interface ControllerDependencies {
    readonly root: HTMLElement;
    readonly selectionManager: ISelectionManager;
    readonly tooltipService: ITooltipService;
    readonly emptySelectionId: ISelectionId | null;
    readonly onFocusChanged: (key: string | null, source: InteractionFocusSource) => void;
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
    private disposed = false;
    private allowInteractions = true;
    private targets: readonly InteractionTarget[] = [];
    private orderedKeys: readonly string[] = [];
    private focusKey: string | null = null;
    private surfaceFocusKey: string | null = null;
    private tooltipKey: string | null = null;
    private tooltipIsTouch = false;
    private readonly listeners: Array<() => void> = [];
    private rootContextMenuAttached = false;
    private rootContextMenuRemover: (() => void) | null = null;
    private readonly gesturePointers = new Map<number, GesturePointer>();
    private gesturePhase: "idle" | "pressed" | "panning" | "pinching" = "idle";
    private gestureStart: GesturePointer | null = null;
    private gestureLast: GesturePointer | null = null;
    private pinchSnapshot: ContextPinchSnapshot | null = null;
    private pinchStartDistance = 0;
    private gestureCameraChanged = false;
    private suppressCurrentGestureSettle = false;
    private suppressSurfaceClick = false;
    private wheelSettleTimer: ReturnType<typeof setTimeout> | null = null;
    private wheelCameraChanged = false;
    private wheelSettleGeneration = 0;
    private wheelNavigation: SurfaceNavigation | null = null;
    private gestureElement: HTMLElement | null = null;

    public constructor(private readonly deps: ControllerDependencies) {}

    public setAllowInteractions(allow: boolean): void {
        this.allowInteractions = allow;
        if (!allow) {
            this.hideTooltip();
            this.resetGestureState();
            this.cancelWheelSettle();
        }
    }

    public get currentFocusKey(): string | null {
        return this.focusKey;
    }

    public get navigationInProgress(): boolean {
        return this.gesturePhase !== "idle" || this.wheelSettleTimer !== null;
    }

    public setSurfaceFocusKey(key: string | null): void {
        this.surfaceFocusKey = key;
    }

    public cancelPendingNavigationSettle(): void {
        this.cancelWheelSettle(false);
        if (this.gesturePhase !== "idle") {
            this.suppressCurrentGestureSettle = true;
        }
    }

    public bind(
        targets: readonly InteractionTarget[],
        surface: SurfaceInteraction | null = null,
        preserveSurfaceClickSuppression?: boolean
    ): void {
        if (this.disposed) {
            return;
        }
        this.detachTargetListeners(
            preserveSurfaceClickSuppression ?? this.suppressSurfaceClick
        );
        this.targets = targets;
        this.orderedKeys = targets.map((target) => target.key);
        if (
            this.focusKey === null
            || !this.orderedKeys.includes(this.focusKey)
        ) {
            this.focusKey = this.orderedKeys[0] ?? null;
        }
        if (
            this.surfaceFocusKey !== null
            && !surface?.hasKey?.(this.surfaceFocusKey)
        ) {
            this.surfaceFocusKey = null;
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
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.hideTooltip();
        this.resetGestureState();
        this.cancelWheelSettle();
        this.detachTargetListeners();
        this.rootContextMenuRemover?.();
        this.rootContextMenuRemover = null;
        this.rootContextMenuAttached = false;
    }

    private attachTarget(target: InteractionTarget): void {
        const element = target.element;

        this.on(element, "pointerdown", () => {
            this.cancelWheelSettle();
        });
        this.on(element, "click", (event) => {
            const pointer = event as MouseEvent;
            this.cancelWheelSettle();
            pointer.stopPropagation();
            if (!this.allowInteractions) {
                return;
            }
            if ((pointer.button ?? 0) !== 0) {
                return;
            }
            this.focus(target.key, false, "pointer");
            const multiSelect = Boolean(pointer.ctrlKey || pointer.metaKey || pointer.shiftKey);
            target.activate?.({ source: "pointer", multiSelect });
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
            this.focus(target.key, false, "focus");
        });

        this.on(element, "keydown", (event) => {
            this.handleKeyDown(target, event as KeyboardEvent);
            this.cancelWheelSettle();
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
            this.cancelWheelSettle();
            this.handleSurfacePointerDown(surface, event as PointerEvent);
        });
        this.on(element, "pointerup", (event) => {
            this.handleSurfacePointerEnd(surface, event as PointerEvent, false);
        });
        this.on(element, "pointercancel", (event) => {
            this.cancelWheelSettle();
            this.handleSurfacePointerEnd(surface, event as PointerEvent, true);
        });
        this.on(element, "lostpointercapture", (event) => {
            this.cancelWheelSettle();
            this.handleSurfacePointerEnd(surface, event as PointerEvent, true);
        });
        this.on(element, "focus", () => {
            if (!this.allowInteractions) {
                this.deps.root.focus();
                return;
            }
            const target = surface.targetForKey?.(this.surfaceFocusKey);
            if (target) {
                this.rememberSurfaceFocus(target.key);
                element.setAttribute("aria-activedescendant", target.key);
            }
        });
        this.on(element, "click", (event) => {
            const pointer = event as MouseEvent;
            this.cancelWheelSettle();
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
            this.focusSurface(target.key, true, "pointer");
            const multiSelect = Boolean(pointer.ctrlKey || pointer.metaKey || pointer.shiftKey);
            target.activate?.({ source: "pointer", multiSelect });
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
                this.cancelWheelSettle();
                return;
            }
            if (
                keyboard.key === "ArrowLeft"
                || keyboard.key === "ArrowRight"
                || keyboard.key === "ArrowUp"
                || keyboard.key === "ArrowDown"
            ) {
                const target = surface.navigate?.(this.surfaceFocusKey, keyboard.key);
                if (target) {
                    keyboard.preventDefault();
                    this.focusSurface(target.key, false, "keyboard");
                    element.setAttribute("aria-activedescendant", target.key);
                }
                this.cancelWheelSettle();
                return;
            }
            if (keyboard.key === "Enter" || keyboard.key === " ") {
                const target = surface.targetForKey?.(this.surfaceFocusKey);
                if (target) {
                    keyboard.preventDefault();
                    this.focusSurface(target.key, true, "keyboard");
                    const multiSelect = Boolean(keyboard.ctrlKey || keyboard.metaKey);
                    target.activate?.({ source: "keyboard", multiSelect });
                }
                this.cancelWheelSettle();
                return;
            }
            if (keyboard.key === "Escape") {
                keyboard.preventDefault();
                this.hideTooltip();
                this.deps.root.focus();
            }
            this.cancelWheelSettle();
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
            this.gestureCameraChanged = false;
            this.suppressCurrentGestureSettle = false;
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
        const midpoint = pointerMidpoint(first, second);
        const snapshot = navigation.beginPinch(midpoint.x, midpoint.y);
        if (!snapshot) {
            this.gesturePointers.delete(second.id);
            return;
        }
        this.gesturePhase = "pinching";
        surface.element.classList.add("profile-lens-context-panning");
        this.pinchSnapshot = snapshot;
        this.pinchStartDistance = pointerDistance(first, second);
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
            if (!first || !second || !this.pinchSnapshot || this.pinchStartDistance <= 0) {
                return true;
            }
            const midpoint = pointerMidpoint(first, second);
            const distance = pointerDistance(first, second);
            this.gestureCameraChanged = navigation.pinchTo(
                this.pinchSnapshot,
                distance / this.pinchStartDistance,
                midpoint.x,
                midpoint.y
            ) || this.gestureCameraChanged;
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
        this.gestureCameraChanged = navigation.panBy(
            pointer.x - this.gestureLast.x,
            pointer.y - this.gestureLast.y
        ) || this.gestureCameraChanged;
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
            this.pinchSnapshot = null;
            this.pinchStartDistance = 0;
            this.suppressSurfaceClick ||= moved || cancelled;
            return;
        }
        this.suppressSurfaceClick ||= moved || cancelled;
        const cameraChanged = this.gestureCameraChanged;
        const settleSuppressed = this.suppressCurrentGestureSettle;
        this.resetGestureState(true);
        surface.navigation?.moveEnd(
            cancelled || !moved || !cameraChanged || settleSuppressed,
            !cancelled && !moved
        );
    }

    private handleSurfaceWheel(surface: SurfaceInteraction, event: WheelEvent): void {
        const navigation = surface.navigation;
        if (!navigation || !this.allowInteractions) {
            return;
        }
        const bounds = surface.element.getBoundingClientRect();
        if (
            !Number.isFinite(event.deltaY)
            || !Number.isFinite(event.deltaMode)
            || !Number.isFinite(event.clientX)
            || !Number.isFinite(event.clientY)
            || !Number.isFinite(bounds.height)
            || bounds.height <= 0
        ) {
            return;
        }
        const delta = normalizeWheelDelta(event.deltaY, event.deltaMode, bounds.height);
        if (delta === 0) {
            return;
        }
        this.hideTooltip();
        // Default scrolling is suppressed only when this tick actually moves the camera. A wheel
        // tick that lands on a clamped camera (zoom limits reached) stays unhandled so the report
        // page keeps scrolling instead of feeling blocked over the map.
        const changed = navigation.zoomAt(
            wheelZoomFactor(delta, navigation.wheelSensitivity),
            event.clientX - bounds.left,
            event.clientY - bounds.top
        );
        if (!changed) {
            // Release any pending gesture settle right away so later clamped ticks reach the
            // page immediately instead of being swallowed until the settle window lapses.
            this.completeWheelSettle();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.cancelWheelSettle(false);
        this.wheelCameraChanged = true;
        this.wheelNavigation = navigation;
        this.wheelSettleTimer = setTimeout(() => {
            this.completeWheelSettle();
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
            this.cancelWheelSettle();
            event.preventDefault();
            event.stopPropagation();
        });
        this.on(reset, "click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.cancelWheelSettle();
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
        this.pinchSnapshot = null;
        this.pinchStartDistance = 0;
        this.gestureCameraChanged = false;
        this.suppressCurrentGestureSettle = false;
        if (!preserveSuppression) {
            this.suppressSurfaceClick = false;
        }
    }

    private cancelWheelSettle(notify = true): void {
        this.wheelSettleGeneration++;
        const navigation = this.wheelNavigation;
        const hadTimer = this.wheelSettleTimer !== null;
        if (this.wheelSettleTimer !== null) {
            clearTimeout(this.wheelSettleTimer);
            this.wheelSettleTimer = null;
        }
        this.wheelNavigation = null;
        this.wheelCameraChanged = false;
        if (notify && hadTimer) {
            navigation?.moveEnd(true);
        }
    }

    private completeWheelSettle(): void {
        if (this.wheelSettleTimer === null) {
            return;
        }
        clearTimeout(this.wheelSettleTimer);
        this.wheelSettleTimer = null;
        const navigation = this.wheelNavigation;
        this.wheelNavigation = null;
        const changed = this.wheelCameraChanged;
        this.wheelCameraChanged = false;
        this.wheelSettleGeneration++;
        navigation?.moveEnd(!changed);
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
                    target.activate?.({
                        source: "keyboard",
                        multiSelect: Boolean(event.ctrlKey || event.metaKey)
                    });
                }
                if (this.allowInteractions && !target.identity) {
                    target.activate?.({
                        source: "keyboard",
                        multiSelect: Boolean(event.ctrlKey || event.metaKey)
                    });
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
        this.focus(key, false, "keyboard");
        const target = this.targets.find((entry) => entry.key === key);
        (target?.element as unknown as { focus?: () => void } | undefined)?.focus?.();
    }

    private focus(
        key: string,
        forceChange = false,
        source: InteractionFocusSource = "focus"
    ): void {
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
        this.deps.onFocusChanged(key, source);
    }

    private rememberSurfaceFocus(key: string): void {
        this.surfaceFocusKey = key;
    }

    private focusSurface(
        key: string,
        forceChange: boolean,
        source: InteractionFocusSource
    ): void {
        if (!this.allowInteractions) {
            return;
        }
        if (this.surfaceFocusKey === key && !forceChange) {
            return;
        }
        this.surfaceFocusKey = key;
        this.deps.onFocusChanged(key, source);
    }

    private attachRootContextMenu(): void {
        if (this.disposed || this.rootContextMenuAttached) {
            return;
        }
        this.rootContextMenuAttached = true;
        const handler = (event: Event) => {
            const pointer = event as MouseEvent;
            event.preventDefault();
            if (!this.allowInteractions) {
                return;
            }
            this.hideTooltip();
            void this.deps.selectionManager.showContextMenu(
                this.deps.emptySelectionId ?? ({} as ISelectionId),
                { x: pointer.clientX ?? 0, y: pointer.clientY ?? 0 }
            );
        };
        this.deps.root.addEventListener("contextmenu", handler);
        this.rootContextMenuRemover = () => {
            this.deps.root.removeEventListener("contextmenu", handler);
        };
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

    private detachTargetListeners(preserveSurfaceClickSuppression = false): void {
        this.resetGestureState(preserveSurfaceClickSuppression);
        this.cancelWheelSettle(false);
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
