/* Mocked simulator header lifecycle; live MSFS must verify hidden-view polling. */
function runWindowTests(source) {
    var module = { exports: {} }, checks = 0;
    function check(value, message) { checks++; if (!value) throw new Error(message); }
    new Function("module", "TemplateElement", source)(module, class {});
    var listeners = {}, closeEvents = {}, hideEvents = {}, nativeCloses = 0;
    var close = { Validate: function () { nativeCloses++; },
        addEventListener: function (name, callback, capture) {
            check(capture === true, "close intercepted before default click handlers");
            closeEvents[name] = callback;
        } };
    var headerReady = false;
    var frame = { style: {}, addEventListener: function (name, callback) { listeners[name] = callback; },
        querySelector: function () { return headerReady ? close : null; } };
    var panel = new module.exports.DescPlanPanel();
    panel.reader = { running: true };
    panel.querySelector = function (selector) {
        return selector === "ingame-ui" ? frame : {
            addEventListener: function (name, callback) { hideEvents[name] = callback; }
        };
    };
    panel.setupWindow();
    check(!closeEvents.click, "missing header tolerated until panelActive");
    headerReady = true;
    listeners.panelActive();
    close.Validate();
    check(nativeCloses === 0, "native toolbar deactivation replaced");
    var prevented = false, stopped = false;
    closeEvents.click({ preventDefault: function () { prevented = true; },
        stopImmediatePropagation: function () { stopped = true; } });
    check(prevented && stopped && frame.style.display === "none", "X hides frame and suppresses normal close");
    check(panel.reader.running, "hide leaves reader running");
    listeners.panelActive();
    check(frame.style.display === "", "reactivation restores frame");
    hideEvents.click();
    check(frame.style.display === "none" && panel.reader.running, "fallback hide button also retains reader");
    return "PASS: " + checks + " panel window checks (mocked header)";
}
if (typeof require !== "undefined" && require.main === module) {
    console.log(runWindowTests(require("fs").readFileSync(require("path").join(__dirname,
        "../addon/PackageSources/html_ui/InGamePanels/DescPlanReader/DescPlanReader.js"), "utf8")));
}
