GlideLink 0.3.0

LOCAL DEVELOPMENT / INSTALL
1. Close MSFS before replacing the installed addon.
2. If source files changed, run build-addon.cmd from this folder (MSFS SDK required).
   It launches build-addon.ps1 and builds the installable addon\Packages\glidelink
   package. Skip this step only if that package already contains the latest changes.
   The script builds locally; it does not copy anything into Community.
3. Remove the previous GlideLink folder from Community, if present, then copy the
   entire freshly built addon\Packages\glidelink folder into Community.
4. Start desc-calc on localhost:8080, start MSFS and open the GlideLink toolbar panel.
   Use X or Hide window to hide the window while keeping the panel running (live test required).

BUILD
The user runs SDK builds manually. Codex must not invoke the SDK build unless asked.
Run build-addon.cmd from this folder (MSFS SDK required).
The script finds the workspace SDK in ..\lib, or falls back to C:\MSFS SDK.
Output: addon\Packages\glidelink. Building does not install it into Community.

SOURCE: addon\PackageSources; project: addon\Project.xml.
API: http://127.0.0.1:8080/msfs, POST /poll and /flightplan/{requestId}?kind=...
Optional tests with Node: node tests\panel-tests.js


TELEMETRY (0.3.0)
Poll includes optional telemetry.groundSpeedKnots, telemetry.nextWaypoint and
telemetry.distanceToNextWaypointNm, plus sampledAt. Distance is straight-line NM
from the FBW left ND's active TO waypoint. Zero speed/distance are valid.
Missing/invalid values are omitted; heartbeat continues even without SimVar data.
The PPOS placeholder is not a target waypoint. No new full-plan polling is added.
The data is visible in the panel's diagnostic JSON and, with the updated desc-calc,
on the generated descent plan page as continuously refreshed readings.

This update changes only HTML/JS assets; the existing compiled panel registration
is unchanged and reused. Package files, manifest version and layout were updated.
The usual SDK build remains available. Compare telemetry to the ND in a live test.

WINDOW / ICON UPDATE (source changes; run your usual build before installing)
The X button now hides the ingame-ui frame without deactivating the toolbar panel,
following the simple mechanism observed in the locally installed GSX panel.
Hide window provides the same behavior if the simulator header is unavailable.
To show it again, toggle the toolbar icon off, then on. Off disconnects the reader.
Actual unloading still stops the reader normally. No permanent background service.
Hidden-view timer/SimVar behavior must be checked in MSFS; mocks cannot prove it.
The icon uses a curved descent arrow and runway, with closed filled SVG contours
instead of open strokes to avoid unwanted triangular fills in the toolbar.
Window mock checks: node tests\window-tests.js

GROUND TEST / HIDDEN MOUSE FIX
Ground testing confirmed the hidden panel keeps the connection and telemetry alive.
Flight/descent testing is still pending.
Outer document/host layers now ignore pointer events and no longer force a full-height
transparent surface. Only the visible frame accepts mouse input. Verify cockpit
clicks and wheel input over the former panel area after hiding, then verify panel
controls after reopening. Actual simulator input passthrough still needs a live test.
The small dot above the descent curve has been removed. Build before installing.
