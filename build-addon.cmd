@echo off
setlocal
cd /d "%~dp0addon"
set "DESC_SDK_TOOL=%~dp0..\lib\msfs2020-sdk\0.24.6\sdk\Tools\bin\fspackagetool.exe"
if not exist "%DESC_SDK_TOOL%" set "DESC_SDK_TOOL=C:\MSFS SDK\Tools\bin\fspackagetool.exe"
if not exist "%DESC_SDK_TOOL%" (
  echo MSFS2020 SDK not found. Use Developer Mode to build addon\Project.xml.
  exit /b 1
)
echo This SDK build can launch MSFS. It does not install into Community.
"%DESC_SDK_TOOL%" "%CD%\Project.xml" -rebuild -nopause %*
if errorlevel 1 exit /b 1
if not exist "Packages\glidelink\InGamePanels\DescPlanReader.spb" (
  echo No panel SPB produced. Open Project.xml in MSFS Developer Mode and Build All.
  exit /b 1
)
echo Copy this entire folder into Community:
echo %CD%\Packages\glidelink
