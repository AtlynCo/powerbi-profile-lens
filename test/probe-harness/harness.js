/**
 * Browser probe harness.
 *
 * Mounts the packaged visual bundle with a minimal host implementation so layout, focus, high
 * contrast and network behaviour are measured on the artifact that would actually be submitted.
 * Deliberately plain JavaScript: nothing here is compiled or bundled with the visual.
 */
(function () {
    function selectionId(key) {
        return {
            key: key,
            equals: function (other) { return Boolean(other) && other.key === key; },
            includes: function (other) { return Boolean(other) && other.key === key; },
            getKey: function () { return key; },
            getSelector: function () { return { key: key }; },
            getSelectorsByColumn: function () { return {}; },
            hasIdentity: function () { return true; }
        };
    }

    function metadata(displayName, role, type) {
        var roles = {};
        roles[role] = true;
        return {
            displayName: displayName,
            queryName: "Table." + displayName,
            roles: roles,
            type: type
        };
    }

    function buildDataView(config) {
        var entities = config.entities;
        var periods = config.periods || [];
        var bands = config.bands;
        var series = config.series || [];
        var profiles = config.profiles;
        var valueSources = profiles.map(function (profile) {
            return metadata(profile, "Profiles", { numeric: true });
        });
        var valueCount = Math.max(valueSources.length, 1);
        var seriesCount = Math.max(series.length, 1);

        var rowLevels = [{ sources: [metadata("Entity", "Hierarchy")] }];
        if (periods.length > 0) {
            rowLevels.push({ sources: [metadata("Period", "Hierarchy")] });
        }
        rowLevels.push({ sources: [metadata("Band", "Hierarchy")] });

        function bandNodes(entityIndex, periodIndex) {
            return bands.map(function (band, bandIndex) {
                var values = {};
                for (var seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
                    for (var profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
                        var magnitude = 40 - Math.abs(bandIndex - 2) * 7
                            + profileIndex * 3 + seriesIndex * 5 + entityIndex * 2;
                        values[seriesIndex * valueCount + profileIndex] = { value: magnitude };
                    }
                }
                return {
                    value: band,
                    identity: { key: "band:" + entityIndex + ":" + periodIndex + ":" + bandIndex },
                    values: values
                };
            });
        }

        var entityNodes = entities.map(function (entity, entityIndex) {
            var children = periods.length > 0
                ? periods.map(function (period, periodIndex) {
                    return {
                        value: period,
                        identity: { key: "period:" + entityIndex + ":" + periodIndex },
                        children: bandNodes(entityIndex, periodIndex)
                    };
                })
                : bandNodes(entityIndex, -1);
            return {
                value: entity,
                identity: { key: "entity:" + entityIndex },
                children: children
            };
        });

        return {
            metadata: {
                columns: rowLevels.map(function (level) { return level.sources[0]; }).concat(valueSources)
            },
            matrix: {
                rows: { levels: rowLevels, root: { children: entityNodes } },
                columns: {
                    levels: series.length > 0 ? [{ sources: [metadata("Series", "Series")] }] : [],
                    root: {
                        children: series.length > 0
                            ? series.map(function (label, index) {
                                return { value: label, identity: { key: "series:" + index } };
                            })
                            : valueSources.map(function (source, index) {
                                return { value: source.displayName, identity: { key: "value:" + index } };
                            })
                    }
                },
                valueSources: valueSources
            }
        };
    }

    function buildHost(options) {
        var highContrast = Boolean(options.highContrast);
        var calls = { tooltipShow: 0, tooltipHide: 0, contextMenu: 0, select: 0 };
        var selected = [];
        var counter = 0;
        var palette = {
            isHighContrast: highContrast,
            foreground: { value: highContrast ? "#FFFFFF" : "#252423" },
            foregroundLight: { value: "#FFFFFF" },
            foregroundDark: { value: "#000000" },
            foregroundNeutralLight: { value: "#FFFFFF" },
            foregroundNeutralDark: { value: "#000000" },
            foregroundNeutralSecondary: { value: "#FFFFFF" },
            foregroundNeutralSecondaryAlt: { value: "#FFFFFF" },
            foregroundSelected: { value: highContrast ? "#00FF00" : "#000000" },
            foregroundButton: { value: "#FFFFFF" },
            background: { value: highContrast ? "#000000" : "#FFFFFF" },
            backgroundLight: { value: "#FFFFFF" },
            backgroundNeutral: { value: "#FFFFFF" },
            backgroundDark: { value: "#000000" },
            hyperlink: { value: "#00B7C3" },
            visitedHyperlink: { value: "#00B7C3" },
            selection: { value: "#00FF00" },
            separator: { value: "#C8C6C4" },
            shapeStroke: { value: "#252423" },
            getColor: function () { return { value: "#118DFF" }; },
            reset: function () { return palette; }
        };

        var host = {
            createSelectionIdBuilder: function () {
                var key = "";
                var builder = {
                    withCategory: function () { return builder; },
                    withSeries: function () { return builder; },
                    withMeasure: function () { return builder; },
                    withMatrixNode: function (node) {
                        key += "|node:" + ((node.identity && node.identity.key) || String(node.value));
                        return builder;
                    },
                    withTable: function () { return builder; },
                    createSelectionId: function () { return selectionId(key || "id:" + counter++); }
                };
                return builder;
            },
            createSelectionManager: function () {
                return {
                    select: function (id) {
                        calls.select++;
                        selected = Array.isArray(id) ? id : [id];
                        return Promise.resolve(selected);
                    },
                    showContextMenu: function () {
                        calls.contextMenu++;
                        return Promise.resolve({});
                    },
                    hasSelection: function () { return selected.length > 0; },
                    clear: function () { selected = []; return Promise.resolve({}); },
                    getSelectionIds: function () { return selected; },
                    registerOnSelectCallback: function (callback) { host.onSelect = callback; },
                    toggleExpandCollapse: function () { return Promise.resolve({}); }
                };
            },
            createLocalizationManager: function () {
                return {
                    getDisplayName: function (key) {
                        return window.profileLensResources[key] || key;
                    }
                };
            },
            colorPalette: palette,
            persistProperties: function () { },
            eventService: {
                renderingStarted: function () { window.profileLensEvents.started++; },
                renderingFinished: function () { window.profileLensEvents.finished++; },
                renderingFailed: function (unused, reason) {
                    window.profileLensEvents.failed++;
                    window.profileLensEvents.reason = reason;
                }
            },
            tooltipService: {
                enabled: function () { return true; },
                show: function () { calls.tooltipShow++; },
                move: function () { },
                hide: function () { calls.tooltipHide++; }
            },
            hostCapabilities: { allowInteractions: options.allowInteractions !== false },
            locale: options.locale || "en-US",
            fetchMoreData: function () { return false; },
            instanceId: "probe",
            refreshHostData: function () { },
            applyJsonFilter: function () { },
            launchUrl: function () { },
            displayWarningIcon: function () { },
            telemetry: { trace: function () { } },
            switchFocusModeState: function () { }
        };
        host.calls = calls;
        return host;
    }

    window.profileLensEvents = { started: 0, finished: 0, failed: 0, reason: null };
    window.profileLensResources = window.profileLensResources || {};

    window.mountProfileLens = function (options) {
        var namespace = window.atlynProfileLens;
        var plugin = namespace && (namespace.default || namespace);
        if (!plugin || typeof plugin.create !== "function") {
            throw new Error("packaged visual plugin was not found on the page");
        }
        var container = document.getElementById("visual-root");
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        container.style.width = options.width + "px";
        container.style.height = options.height + "px";

        var host = buildHost(options);
        var instance = plugin.create({ element: container, host: host });
        window.profileLensHost = host;
        window.profileLensInstance = instance;
        window.profileLensUpdate = function (updateOptions) {
            instance.update({
                viewport: { width: updateOptions.width, height: updateOptions.height },
                dataViews: updateOptions.dataViews,
                type: 2,
                viewMode: 1,
                editMode: 0,
                isInFocus: false,
                operationKind: 0,
                jsonFilters: []
            });
        };

        var dataView = buildDataView(options);
        window.profileLensDataView = dataView;
        window.profileLensUpdate({
            width: options.width,
            height: options.height,
            dataViews: [dataView]
        });
        return true;
    };

    window.resizeProfileLens = function (width, height) {
        var container = document.getElementById("visual-root");
        container.style.width = width + "px";
        container.style.height = height + "px";
        window.profileLensUpdate({
            width: width,
            height: height,
            dataViews: [window.profileLensDataView]
        });
        return true;
    };
})();
