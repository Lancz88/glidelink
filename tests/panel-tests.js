/* Run with Node: node tests/panel-tests.js
 * Also executable in an isolated JS harness; no MSFS or network needed.
 */
async function runPanelTests(source) {
    var timers = new Map(), next = 0, sent = [], receiver;
    var module = { exports: {} }, checks = 0;
    function check(condition, message) { checks++; if (!condition) throw new Error(message); }
    function delay(fn) { timers.set(++next, fn); return next; }
    function cancel(id) { timers.delete(id); }
    function tick() {
        var first = timers.entries().next().value;
        if (!first) throw new Error("No timer");
        timers.delete(first[0]); first[1]();
    }
    new Function("module", "TemplateElement", "setTimeout", "clearTimeout", "RegisterGenericDataListener", "Coherent", "LaunchFlowEvent", source)(
        module, class {}, delay, cancel,
        function (ready) { delay(ready); return {
            onDataReceived: function (key, fn) { receiver = fn; },
            send: function (key, packet) { sent.push({ transport: "generic", key: key, packet: packet }); }
        }; },
        { on: function () {} },
        function (name, key, id, json) { sent.push({ transport: "flow", packet: JSON.parse(json) }); }
    );
    var reader = new module.exports.Reader(function () {}); reader.running = true;
    reader.connectBus(); tick(); tick();
    check(reader.diag.genericReady && reader.diag.flowReady, "transports initialized");
    check(reader.diag.version === "0.3.0" && reader.diag.genericInitState === "ready" && reader.diag.genericFunctionAvailable, "dependency diagnostics identify fixed panel");
    function reply(plans) { receiver({ busId: 123, packagedId: 456,
        data: [{ topic: "flightPlanManager.syncResponse", data: { syncClientID: 789, plans: plans } }] }); }
    var active = { originAirport: "TEST", destinationAirport: "DEST", activeLegIndex: 1,
        segments: { enrouteSegment: { legs: [
            { ident: "FIX", pilotEnteredAltitudeConstraint: { altitude1: 7000, altitudeDescriptor: 1 },
                pilotEnteredSpeedConstraint: { speed: 220 }, calculated: { distance: 15.2 } },
            { isDiscontinuity: true }
        ] }, missedApproachSegment: { legs: [{ ident: "MISSED" }] } } };
    var promise = reader.snapshot();
    check(sent.length === 1 && sent[0].key === "wt.eb.evt", "generic snapshot request sent");
    check(sent[0].packet.data[0].topic === "flightPlanManager.syncRequest", "only read request topic");
    check(reader.diag.sentRequests === 1 && reader.diag.lastTransport === "generic", "request diagnostics recorded");
    var busy = false; try { await reader.snapshot(); } catch (e) { busy = /progress/.test(e.message); }
    check(busy, "reject concurrent panel snapshot");
    reply({ 0: active, 1: { segments: {} } });
    var result = await promise;
    check(result.kind === "ok" && result.body.ok, "successful snapshot");
    check(result.body.activePlan === active, "raw constraints, discontinuities, distances and missed approach preserved");
    check(result.body.temporaryPlanExists === true && result.body.planIndex === 0, "temporary never substituted");
    check(result.body.transport === "generic", "transport identified");
    check(reader.diag.lastFbwTopic === "flightPlanManager.syncResponse", "FBW topic name recorded without payload");
    promise = reader.snapshot(); reply({});
    result = await promise; check(result.body.error === "NO_ACTIVE_PLAN", "no active plan explicit");
    promise = reader.snapshot(); reply({ 0: { originAirport: "", destinationAirport: "", segments: {} } });
    result = await promise; check(result.body.error === "EMPTY_ACTIVE_PLAN", "empty plan explicit");
    promise = reader.snapshot(); reply({ 0: { incompatible: true } });
    var schema = false; try { await promise; } catch (e) { schema = /schema/.test(e.message); }
    check(schema, "unknown schema fails instead of inventing data");
    promise = reader.snapshot(); tick(); await Promise.resolve(); await Promise.resolve();
    check(sent[sent.length - 1].transport === "flow", "generic timeout falls back to flow");
    reader.receive({ busId: 124, data: [{ topic: "SYNC_flightPlanManager.syncResponse", data: { plans: { 0: active } } }] }, "flow");
    result = await promise; check(result.body.transport === "flow", "flow fallback result accepted");
    promise = reader.snapshot();
    tick(); await Promise.resolve(); await Promise.resolve(); tick();
    var timedOut = false; try { await promise; } catch (e) { timedOut = /No FBW response/.test(e.message); }
    check(timedOut && reader.pending === null, "both transport timeouts clean pending state");
    reply({ 0: active }); check(reader.pending === null, "unsolicited response is not cached");
    check(sent.every(function (entry) { return entry.packet.data.length === 1 && entry.packet.data[0].topic === "flightPlanManager.syncRequest"; }), "no mutation events sent");
    // Reproduce the original in-game failure: the generic helper was not loaded.
    var missingModule = { exports: {} };
    new Function("module", "TemplateElement", "setTimeout", "clearTimeout", "RegisterGenericDataListener", "Coherent", "LaunchFlowEvent", source)(
        missingModule, class {}, delay, cancel, undefined, { on: function () {} }, function () {}
    );
    var missing = new missingModule.exports.Reader(function () {}); missing.running = true;
    promise = missing.snapshot();
    check(missing.diag.genericInitState === "missing-function" && !missing.diag.genericFunctionAvailable, "missing dependency distinguished from waiting listener");
    tick();
    var missingMessage = ""; try { await promise; } catch (e) { missingMessage = e.message; }
    check(/missing-function/.test(missingMessage) && /No FBW response via flow/.test(missingMessage), "failure preserves missing dependency and fallback timeout");
    var failedModule = { exports: {} };
    new Function("module", "TemplateElement", "setTimeout", "clearTimeout", "RegisterGenericDataListener", "Coherent", "LaunchFlowEvent", source)(
        failedModule, class {}, delay, cancel, function () { throw new Error("registration rejected"); }, { on: function () {} }, undefined
    );
    var failed = new failedModule.exports.Reader(function () {}); failed.connectBus();
    check(failed.diag.genericInitState === "failed" && /registration rejected/.test(failed.diag.genericError), "initialization error retained separately");
    var waitingModule = { exports: {} };
    new Function("module", "TemplateElement", "setTimeout", "clearTimeout", "RegisterGenericDataListener", "Coherent", "LaunchFlowEvent", source)(
        waitingModule, class {}, delay, cancel, function () { return {}; }, { on: function () {} }, undefined
    );
    var waiting = new waitingModule.exports.Reader(function () {}); waiting.connectBus();
    check(waiting.diag.genericFunctionAvailable && waiting.diag.genericInitState === "waiting-ready", "registered but never ready distinguished");
    return "PASS: " + checks + " panel checks (mocked MSFS bus only)";
}
async function runPanelTransportTests(source) {
    var module = { exports: {} }, requests = [], replies = [], checks = 0;
    var values = {}, failedReads = {};
    var simVar = { GetSimVarValue: function (name) {
        if (failedReads[name]) throw new Error("Unavailable SimVar");
        return values[name];
    } };
    function check(condition, message) { checks++; if (!condition) throw new Error(message); }
    function FakeXHR() { this.headers = {}; }
    FakeXHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
    FakeXHR.prototype.setRequestHeader = function (key, value) { this.headers[key] = value; };
    FakeXHR.prototype.send = function (body) {
        requests.push({ method: this.method, url: this.url, headers: this.headers, body: JSON.parse(body) });
        var reply = replies.shift();
        if (reply.networkError) { this.onerror(); return; }
        this.status = 200;
        this.responseText = JSON.stringify(reply);
        this.onload();
    };
    new Function("module", "TemplateElement", "XMLHttpRequest", "setTimeout", "clearTimeout", "SimVar", source)(
        module, class {}, FakeXHR, function () { return 1; }, function () {}, simVar);
    var reader = new module.exports.Reader(function () {});
    reader.running = true;
    reader.connectBus = function () {};
    reader.snapshot = async function () { return { kind: "ok", body: { ok: true, schemaVersion: 1 } }; };
    replies.push({ requestId: "abc-123" }, { accepted: true });
    await reader.poll();
    check(requests.length === 2, "poll followed by one result");
    check(requests[0].method === "POST" && requests[0].url === "http://127.0.0.1:8080/msfs/poll", "new poll URL");
    check(requests[1].url === "http://127.0.0.1:8080/msfs/flightplan/abc-123?kind=ok", "new result URL");
    check(requests[1].body.ok && requests[1].headers["Content-Type"] === "text/plain;charset=UTF-8", "snapshot and Coherent content type retained");
    check(!requests[0].body.telemetry, "heartbeat works without any telemetry values");
    replies.push({});
    await reader.poll();
    check(requests.length === 3, "no plan posted without a command");
    reader.snapshot = async function () { throw new Error("Synthetic read failure"); };
    replies.push({ requestId: "failed-read" }, { accepted: true });
    await reader.poll();
    check(requests[4].url.endsWith("/flightplan/failed-read?kind=error") && requests[4].body.error === "FBW_READ_FAILED", "read errors use correlated result endpoint");
    replies.push({ networkError: true });
    await reader.poll();
    check(reader.diag.state === "server disconnected" && /Server unavailable/.test(reader.diag.lastError), "unavailable app reported");

    var gs = "GROUND VELOCITY", ident0 = "L:A32NX_EFIS_L_TO_WPT_IDENT_0";
    var ident1 = "L:A32NX_EFIS_L_TO_WPT_IDENT_1", distance = "L:A32NX_EFIS_L_TO_WPT_DISTANCE";
    values[gs] = 420.25;
    // Golden name words checked against the installed FBW ND's SimVarString.pack(..., 9).
    values[ident0] = 920050101; values[ident1] = 0; values[distance] = 32.4;
    replies.push({});
    await reader.poll();
    var telemetry = requests[requests.length - 1].body.telemetry;
    check(telemetry.groundSpeedKnots === 420.25 && telemetry.nextWaypoint === "TELTU"
        && telemetry.distanceToNextWaypointNm === 32.4, "all three telemetry values ride the poll");
    check(Number.isFinite(Date.parse(telemetry.sampledAt)), "sample carries an acquisition timestamp");

    values[gs] = 0; values[distance] = 0;
    replies.push({});
    await reader.poll();
    telemetry = requests[requests.length - 1].body.telemetry;
    check(telemetry.groundSpeedKnots === 0 && telemetry.distanceToNextWaypointNm === 0, "zero speed and zero distance are valid");

    values[ident0] = 183111209339106; values[ident1] = 26;
    check(reader.readTelemetry().nextWaypoint === "ABCDEFGH9", "48-bit name word and ninth character decoded");
    values[ident0] = 13831281; values[ident1] = 0;
    replies.push({});
    await reader.poll();
    telemetry = requests[requests.length - 1].body.telemetry;
    check(telemetry.groundSpeedKnots === 0 && !telemetry.nextWaypoint && !("distanceToNextWaypointNm" in telemetry), "PPOS omits navigation and clears old waypoint");

    values[ident0] = 920050101; failedReads[gs] = true; values[distance] = -1;
    replies.push({});
    await reader.poll();
    telemetry = requests[requests.length - 1].body.telemetry;
    check(telemetry.nextWaypoint === "TELTU" && !("groundSpeedKnots" in telemetry)
        && !("distanceToNextWaypointNm" in telemetry), "failed speed and invalid distance do not block waypoint or heartbeat");
    failedReads[gs] = false; values[gs] = NaN; values[ident0] = 0; values[ident1] = 0;
    replies.push({});
    await reader.poll();
    check(!requests[requests.length - 1].body.telemetry, "all unavailable values omit telemetry instead of repeating old data");

    var missingApi = { exports: {} };
    new Function("module", "TemplateElement", source)(missingApi, class {});
    check(new missingApi.exports.Reader(function () {}).readTelemetry() === undefined, "missing SimVar API is harmless");
    reader.stop();
    return "PASS: " + checks + " GlideLink HTTP checks (mocked transport)";
}

if (typeof require === "function") {
    var fs = require("node:fs"), path = require("node:path");
    runPanelTests(fs.readFileSync(path.join(__dirname, "../addon/PackageSources/html_ui/InGamePanels/DescPlanReader/DescPlanReader.js"), "utf8"))
        .then(async function (result) {
            console.log(result);
            console.log(await runPanelTransportTests(fs.readFileSync(path.join(__dirname, "../addon/PackageSources/html_ui/InGamePanels/DescPlanReader/DescPlanReader.js"), "utf8")));
        }).catch(function (e) { console.error(e); process.exitCode = 1; });
}
