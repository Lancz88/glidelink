param([string]$SdkRoot, [switch]$Steam)
$ErrorActionPreference = 'Stop'
if (!$SdkRoot) {
    $SdkRoot = Join-Path $PSScriptRoot '..\lib\msfs2020-sdk\0.24.6\sdk'
    if (!(Test-Path -LiteralPath (Join-Path $SdkRoot 'Tools\bin\fspackagetool.exe'))) { $SdkRoot = 'C:\MSFS SDK' }
}
$tool = Join-Path $SdkRoot 'Tools\bin\fspackagetool.exe'
if (!(Test-Path -LiteralPath $tool)) { throw "MSFS2020 SDK package tool not found: $tool" }
$project = Join-Path $PSScriptRoot 'addon\Project.xml'
Write-Host 'This SDK build can launch MSFS. It does not install into Community.'
Push-Location (Join-Path $PSScriptRoot 'addon')
try {
    $buildArgs = @($project, '-rebuild', '-nopause')
    if ($Steam) { $buildArgs += '-forcesteam' }
    & $tool @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "MSFS build failed: exit $LASTEXITCODE" }
    $package = Join-Path $PSScriptRoot 'addon\Packages\glidelink'
    $spb = Join-Path $package 'InGamePanels\DescPlanReader.spb'
    if (!(Test-Path -LiteralPath $spb)) { throw 'Build did not produce the panel SPB. Open addon\Project.xml in MSFS Developer Mode, then Build All.' }
    Write-Host "Copy this complete folder into Community: $package"
} finally { Pop-Location }
