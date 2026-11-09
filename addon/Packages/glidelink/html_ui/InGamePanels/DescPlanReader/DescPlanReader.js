/* Experimental reader of FBW's internal, version-dependent snapshot protocol.
 * Original adapter, based on upstream protocol documentation listed in SOURCES.md.
 * Sends ONLY flightPlanManager.syncRequest; never edits a flight plan or SimVar.
 */
(function () {
    "use strict";
    var APP_URL = "http://127.0.0.1:8080/msfs";
    var KEY = "wt.eb.evt";
    var REQUEST = "flightPlanManager.syncRequest";
    var RESPONSE = "flightPlanManager.syncResponse";

    function http(method, path, data) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, APP_URL + path, true);
            xhr.timeout = 3000;
            xhr.onload = function () {
                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new Error("Server HTTP " + xhr.status)); return;
                }
                try { resolve(JSON.parse(xhr.responseText || "{}")); }
                catch (e) { reject(new Error("Invalid server response")); }
            };
            xhr.onerror = function () { reject(new Error("Server unavailable; start desc-calc")); };
            xhr.ontimeout = function () { reject(new Error("Server timeout")); };
            // text/plain avoids an unnecessary CORS preflight in the Coherent browser.
            xhr.setRequestHeader("Content-Type", "text/plain;charset=UTF-8");
            xhr.send(JSON.stringify(data || {}));
        });
    }

    function Reader(render) {
        this.render = render;
        this.busId = Math.floor(Math.random() * 9007199254740991);
        this.listener = null;
        this.pending = null;
        this.running = false;
        this.genericAttempted = false;
        this.diag = { version: "0.3.0", genericReady: false, flowReady: false,
            genericFunctionAvailable: false, genericInitState: "not-started", genericError: null,
            sentRequests: 0, lastTransport: null, lastFbwTopic: null,
            receivedPackages: 0, receivedFbwEvents: 0, state: "starting", lastError: null };
    }
    Reader.prototype.show = function () { this.render(JSON.stringify(this.diag, null, 2)); };

    // Telemetry is optional: a missing API or individual read must never interrupt polling.
    function readNumber(name, unit) {
        try {
            if (typeof SimVar === "undefined" || typeof SimVar.GetSimVarValue !== "function") return undefined;
            var value = SimVar.GetSimVarValue(name, unit);
            return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
        } catch (e) { return undefined; }
    }

    function readNextWaypoint() {
        var words = [readNumber("L:A32NX_EFIS_L_TO_WPT_IDENT_0", "number"),
            readNumber("L:A32NX_EFIS_L_TO_WPT_IDENT_1", "number")];
        if (!words.every(function (word) { return Number.isSafeInteger(word) && word < Math.pow(2, 48); })) return undefined;

        // FBW's ND stores up to nine characters in two words: eight 6-bit codes per word.
        // Codes 1..63 represent ASCII 32..94; zero is padding. Avoid 32-bit JS shifts.
        var ident = "";
        for (var index = 0; index < 9; index++) {
            var code = Math.floor(words[Math.floor(index / 8)] / Math.pow(64, index % 8)) % 64;
            if (code > 0) ident += String.fromCharCode(code + 31);
        }
        ident = ident.trim();
        return ident && ident !== "PPOS" ? ident : undefined;
    }

    Reader.prototype.readTelemetry = function () {
        // Build a new sample every time so unavailable fields cannot retain stale values.
        var telemetry = {};
        var groundSpeed = readNumber("GROUND VELOCITY", "knots");
        if (groundSpeed !== undefined) telemetry.groundSpeedKnots = groundSpeed;

        var waypoint = readNextWaypoint();
        if (waypoint !== undefined) {
            telemetry.nextWaypoint = waypoint;
            // Same source as the ND's TO waypoint distance: straight-line NM, not route DTG.
            var distance = readNumber("L:A32NX_EFIS_L_TO_WPT_DISTANCE", "number");
            if (distance !== undefined) telemetry.distanceToNextWaypointNm = distance;
        }

        if (Object.keys(telemetry).length === 0) return undefined;
        telemetry.sampledAt = new Date().toISOString();
        return telemetry;
    };

    Reader.prototype.connectBus = function () {
        var self = this;
        self.diag.genericFunctionAvailable = typeof RegisterGenericDataListener === "function";
        if (!self.genericAttempted && !self.diag.genericFunctionAvailable) self.diag.genericInitState = "missing-function";
        if (!self.genericAttempted && self.diag.genericFunctionAvailable) {
            self.genericAttempted = true;
            self.diag.genericInitState = "waiting-ready";
            try {
                self.listener = RegisterGenericDataListener(function () {
                    // Some implementations invoke the ready callback synchronously.
                    setTimeout(function () {
                        try {
                            self.listener.onDataReceived(KEY, function (packet) { self.receive(packet, "generic"); });
                            self.diag.genericReady = true;
                            self.diag.genericInitState = "ready";
                            self.show();
                        } catch (e) {
                            self.diag.genericInitState = "failed";
                            self.diag.genericError = "Generic listener init: " + e.message;
                            self.diag.lastError = self.diag.genericError; self.show();
                        }
                    }, 0);
                });
            } catch (e) {
                self.diag.genericInitState = "failed";
                self.diag.genericError = "Generic listener: " + e.message;
                self.diag.lastError = self.diag.genericError;
            }
        }
        if (!self.diag.flowReady && typeof Coherent !== "undefined" && typeof LaunchFlowEvent === "function") {
            Coherent.on("OnInteractionEvent", function (target, args) {
                if (args && args[0] === "EB_EVENTS" && args[2]) self.receive(args[2], "flow");
            });
            self.diag.flowReady = true;
        }
    };
    Reader.prototype.receive = function (packet, transport) {
        if (!this.running) return;
        try {
            if (typeof packet === "string") packet = JSON.parse(packet);
            if (!packet || packet.busId === this.busId || !Array.isArray(packet.data)) return;
            this.diag.receivedPackages++;
            for (var i = 0; i < packet.data.length; i++) {
                var event = packet.data[i];
                if (typeof event.topic === "string" && /^(SYNC_)?flightPlan/.test(event.topic)) {
                    this.diag.receivedFbwEvents++;
                    this.diag.lastFbwTopic = event.topic.slice(0, 120);
                }
                if (!this.pending || (event.topic !== RESPONSE && event.topic !== "SYNC_" + RESPONSE)) continue;
                if (!event.data || !event.data.plans || typeof event.data.plans !== "object") continue;
                var pending = this.pending;
                this.pending = null;
                clearTimeout(pending.timer);
                pending.resolve({ packet: event.data, transport: transport });
                break;
            }
        } catch (e) { this.diag.lastError = "Invalid bus packet: " + e.message; }
    };
    Reader.prototype.send = function (transport) {
        // data is deliberately omitted: upstream request payload is undefined.
        var packet = { busId: this.busId, packagedId: Math.floor(Math.random() * 1000000000),
            data: [{ topic: REQUEST, isCached: false }] };
        if (transport === "generic") this.listener.send(KEY, packet);
        else LaunchFlowEvent("ON_MOUSERECT_HTMLEVENT", "EB_EVENTS", String(this.busId), JSON.stringify(packet));
        this.diag.sentRequests++;
    };
    Reader.prototype.attempt = function (transport) {
        var self = this;
        self.diag.lastTransport = transport;
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () {
                self.pending = null;
                reject(new Error("No FBW response via " + transport));
            }, 3500);
            self.pending = { resolve: resolve, reject: reject, timer: timer };
            try { self.send(transport); }
            catch (e) { clearTimeout(timer); self.pending = null; reject(e); }
        });
    };
    Reader.prototype.snapshot = async function () {
        this.connectBus();
        if (this.pending) throw new Error("Snapshot already in progress");
        var received;
        var failures = [];
        if (!this.diag.genericReady) {
            failures.push("Generic unavailable (" + this.diag.genericInitState + ")" +
                (this.diag.genericError ? ": " + this.diag.genericError : ""));
        }
        if (this.diag.genericReady) {
            try { received = await this.attempt("generic"); }
            catch (e) { failures.push(e.message); }
        }
        if (!received && this.diag.flowReady) {
            try { received = await this.attempt("flow"); }
            catch (e) { failures.push(e.message); }
        }
        if (!received) {
            throw new Error(failures.join("; ") || "No usable MSFS event transport in this panel context");
        }
        var active = received.packet.plans[0];
        if (!active) return { kind: "empty", body: { ok: false, error: "NO_ACTIVE_PLAN",
            message: "FBW replied but supplied no active plan at index 0.", diagnostics: this.diag } };
        // Do not guess constraint enum meanings, drop discontinuities, or substitute predictions.
        // Return the original serialized active plan for inspection and later CSV mapping.
        var segments = active.segments;
        if (!segments || typeof segments !== "object") throw new Error("Unsupported FBW active-plan schema: missing segments");
        var nonempty = Object.keys(segments).some(function (name) {
            var segment = segments[name];
            return segment && ((Array.isArray(segment.legs) && segment.legs.length > 0) ||
                (Array.isArray(segment.allLegs) && segment.allLegs.length > 0));
        });
        if (!nonempty && !active.originAirport && !active.destinationAirport) {
            return { kind: "empty", body: { ok: false, error: "EMPTY_ACTIVE_PLAN",
                message: "FBW replied with an empty active plan.", activePlan: active } };
        }
        return { kind: "ok", body: { ok: true, schemaVersion: 1, source: "FBW_INTERNAL_SYNC",
            capturedAt: new Date().toISOString(), transport: received.transport, planIndex: 0,
            temporaryPlanExists: !!received.packet.plans[1],
            warning: "Experimental raw snapshot; verify against MCDU before calculator integration.",
            activePlan: active } };
    };
    Reader.prototype.poll = async function () {
        var self = this;
        if (!self.running) return;
        try {
            self.connectBus();
            self.diag.telemetry = self.readTelemetry();
            var command = await http("POST", "/poll", self.diag);
            if (command.requestId) {
                self.diag.state = "reading"; self.show();
                var result;
                try { result = await self.snapshot(); }
                catch (e) { result = { kind: "error", body: { ok: false, error: "FBW_READ_FAILED",
                    message: e.message, diagnostics: self.diag } }; }
                self.diag.state = result.body.ok ? "snapshot returned" : result.body.error;
                self.diag.lastError = result.body.ok ? null : result.body.message;
                await http("POST", "/flightplan/" + encodeURIComponent(command.requestId) + "?kind=" + result.kind, result.body);
            } else if (self.diag.state === "starting" || self.diag.state === "server disconnected") self.diag.state = "ready";
        } catch (e) { self.diag.state = "server disconnected"; self.diag.lastError = e.message; }
        self.show();
        if (self.running) self.pollTimer = setTimeout(function () { self.poll(); }, 500);
    };
    Reader.prototype.start = function () { if (!this.running) { this.running = true; this.poll(); } };
    Reader.prototype.stop = function () {
        this.running = false; clearTimeout(this.pollTimer);
        if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error("Panel closed")); this.pending = null; }
    };

    class DescPlanPanel extends TemplateElement {
        setupWindow() {
            var frame = this.querySelector("ingame-ui");
            if (!frame) return;
            if (!this.windowEventsBound) {
                this.windowEventsBound = true;
                frame.addEventListener("panelActive", () => {
                    frame.style.display = "";
                    this.setupWindow();
                });
                var hide = this.querySelector("#hide-panel");
                if (hide) hide.addEventListener("click", () => this.hideWindow());
            }
            // The simulator creates its header when the panel becomes active.
            var close = frame.querySelector(".Close.nodrag");
            if (close && this.closeButton !== close) {
                this.closeButton = close;
                // Keep the toolbar panel alive; only hide its window, as GSX does.
                close.Validate = function () {};
                close.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    this.hideWindow();
                }, true);
            }
        }
        hideWindow() {
            var frame = this.querySelector("ingame-ui");
            if (frame) frame.style.display = "none";
        }
        connectedCallback() {
            super.connectedCallback();
            var self = this;
            self.setupWindow();
            if (!self.reader) {
                self.reader = new Reader(function (status) {
                    var out = self.querySelector("#status"); if (out) out.textContent = status;
                });
                var button = self.querySelector("#read-plan");
                if (button) button.addEventListener("click", async function () {
                    button.disabled = true;
                    try {
                        var result = await self.reader.snapshot();
                        self.reader.diag.state = result.body.ok ? "local read succeeded" : result.body.error;
                        self.reader.diag.lastError = result.body.message || null;
                        // Button checks bus access only; API requests receive their own fresh snapshot.
                    } catch (e) { self.reader.diag.lastError = e.message; }
                    self.reader.show(); button.disabled = false;
                });
            }
            self.reader.start();
        }
        disconnectedCallback() {
            if (this.reader) this.reader.stop();
            super.disconnectedCallback();
        }
    }
    // Export only under the test harness; there are no third-party runtime libraries.
    if (typeof module !== "undefined" && module.exports) module.exports = { Reader: Reader, DescPlanPanel: DescPlanPanel };
    else {
        window.customElements.define("ingamepanel-desc-plan-reader", DescPlanPanel);
        checkAutoload();
    }
})();
