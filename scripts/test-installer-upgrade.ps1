$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# A different app ID, executable name, shortcuts and uninstall key are required.
# Never run the production installer against the developer's registry entries.
$testId = [guid]::NewGuid().ToString('N')
$root = Join-Path ([IO.Path]::GetTempPath()) "acroclip-upgrade-$testId"
$project = Join-Path $root 'project'
$stage = Join-Path $root 'stage'
$install = Join-Path $root 'custom folder'
$product = "AcroClipUpgradeTest-$testId"
$packageName = "acroclip-upgrade-$testId"
$cache = Join-Path $env:LOCALAPPDATA "$packageName-updater"
$first = $null
$second = $null
$uninstaller = Join-Path $install "Uninstall $product.exe"
$original = (Get-Location).Path
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class InstallerProbe {
    public class Control { public IntPtr Handle; public string Text; public string ClassName; }
    private delegate bool Callback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, Callback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    public static Control[] Read(int process) {
        var found = new List<Control>();
        EnumWindows((root, unused) => {
            uint owner; GetWindowThreadProcessId(root, out owner);
            if (owner != process) return true;
            EnumChildWindows(root, (window, data) => {
                for (var parent = window; parent != root && parent != IntPtr.Zero; parent = GetParent(parent))
                    if ((GetWindowLong(parent, -16) & 0x10000000) == 0) return true;
                var text = new StringBuilder(4096); var kind = new StringBuilder(256);
                GetWindowText(window, text, text.Capacity); GetClassName(window, kind, kind.Capacity);
                found.Add(new Control { Handle=window, Text=text.ToString(), ClassName=kind.ToString() });
                return true;
            }, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
        return found.ToArray();
    }
    public static void Click(IntPtr window) { SendMessage(window, 0xF5, IntPtr.Zero, IntPtr.Zero); }
}
'@
New-Item -ItemType Directory -Path $project, $stage | Out-Null
Copy-Item -LiteralPath 'release/win-unpacked' -Destination $stage -Recurse
$payload = Join-Path $stage 'win-unpacked'
Rename-Item -LiteralPath (Join-Path $payload 'AcroClip.exe') -NewName "$product.exe"
# Both the NSIS installer store and electron-updater's copied runtime metadata
# must have this test's cache identity. A different app ID alone is insufficient.
$updateConfig = Join-Path $payload 'resources/app-update.yml'
if (Test-Path -LiteralPath $updateConfig) {
    (Get-Content -LiteralPath $updateConfig -Raw) -replace '(?m)^updaterCacheDirName:.*$', "updaterCacheDirName: $packageName-updater" |
        Set-Content -LiteralPath $updateConfig
}
$include = Join-Path $original 'build/installer.nsh'
$config = @{
    electronVersion = (Get-Content (Join-Path $original 'node_modules/electron/package.json') -Raw | ConvertFrom-Json).version
    appId = "dev.acroclip.upgrade-test.$testId"
    productName = $product
    executableName = $product
    win = @{ target = 'nsis'; signExecutable = $false }
    nsis = @{ oneClick = $false; allowToChangeInstallationDirectory = $true; include = $include; runAfterFinish = $false; uninstallDisplayName = $product }
    compression = 'store'
    directories = @{ output = (Join-Path $root 'packages') }
    publish = $null
}
$config | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $root 'builder.json')

function Build-TestInstaller([string] $version) {
    @{ name = $packageName; version = $version; main = 'index.js'; description = 'Isolated installer verification'; author = 'AcroClip'; license = 'GPL-3.0-or-later' } |
        ConvertTo-Json | Set-Content (Join-Path $project 'package.json')
    & bunx --no-install electron-builder --projectDir $project --prepackaged $payload --config (Join-Path $root 'builder.json') --win nsis --x64 --publish never | Out-Host
    if ($LASTEXITCODE) { throw "Fixture packaging failed: $LASTEXITCODE" }
    $matches = @(Get-ChildItem (Join-Path $root 'packages') -Filter "*$version*.exe")
    if ($matches.Count -ne 1) { throw 'Expected one isolated installer' }
    return $matches[0].FullName
}

function Install-Test([string] $file, [string] $arguments) {
    $process = Start-Process -FilePath $file -ArgumentList $arguments -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'Isolated installer timed out' }
    if ($process.ExitCode -ne 0) { throw "Isolated installation failed: $($process.ExitCode)" }
}

function Upgrade-Interactive([string] $file) {
    $process = Start-Process -FilePath $file -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddMinutes(4)
    $finished = $false
    try {
        while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
            $controls = @([InstallerProbe]::Read($process.Id))
            $text = ($controls | ForEach-Object Text) -join "`n"
            if ($text -match 'Choose Install Location|Choose Installation Options|Choose Components|Choose Users|License Agreement|Browse\.\.\.') {
                throw "Upgrade repeated a first-install page: $text"
            }
            $finish = @($controls | Where-Object { $_.ClassName -eq 'Button' -and $_.Text.Replace('&', '') -eq 'Finish' })
            if ($finish.Count -eq 1) {
                $finished = $true
                [InstallerProbe]::Click($finish[0].Handle)
            }
            Start-Sleep -Milliseconds 200
            $process.Refresh()
        }
        if (-not $process.HasExited) { throw 'Interactive isolated upgrade timed out' }
        if ($process.ExitCode -ne 0 -or -not $finished) { throw 'Interactive upgrade did not reach the finish page' }
    } finally {
        if (-not $process.HasExited) { $process.Kill() }
    }
}

try {
    $first = Build-TestInstaller '0.0.1'
    Install-Test $first "/S /currentuser /D=$install"
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'First install did not use the custom path' }
    $executable = Join-Path $install "$product.exe"
    $before = (Get-FileHash -LiteralPath $executable).Hash
    # The external collection and profile represent user data, not installer output.
    $profile = Join-Path $root 'profile'
    New-Item -ItemType Directory -Path $profile | Out-Null
    Set-Content -LiteralPath (Join-Path $profile 'preferences.json') -Value '{"setupComplete":true,"sentinel":"preserve-me"}'
    $settings = (Get-FileHash -LiteralPath (Join-Path $profile 'preferences.json')).Hash
    $second = Build-TestInstaller '0.0.2'
    # No scope or directory switches. Registry detection must reuse the first install.
    Upgrade-Interactive $second
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Upgrade moved the installation' }
    if ((Get-FileHash -LiteralPath $executable).Hash -ne $before) { throw 'Upgrade changed the fixture executable unexpectedly' }
    $entries = @(Get-ChildItem 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall' | Get-ItemProperty | Where-Object DisplayName -eq $product)
    if ($entries.Count -ne 1 -or $entries[0].DisplayVersion -ne '0.0.2') {
        throw 'Upgrade did not retain a single per-user installation at the established path'
    }
    $location = (Get-ItemProperty "HKCU:/Software/$($entries[0].PSChildName)").InstallLocation
    if ($location.TrimEnd('\') -ne $install) { throw 'Upgrade changed the registered installation path' }
    if ((Get-FileHash -LiteralPath (Join-Path $profile 'preferences.json')).Hash -ne $settings) { throw 'Upgrade modified user settings' }
    $env:ACROCLIP_PACKAGED_EXE = $executable
    & bun run test:packaged
    if ($LASTEXITCODE) { throw 'Installed application media check failed' }
    Write-Output 'Verified first install, interactive newer-version upgrade without redundant pages, registry scope/path and installed application media.'
} finally {
    Remove-Item Env:/ACROCLIP_PACKAGED_EXE -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $uninstaller) { Install-Test $uninstaller '/S' }
    $cachedInstaller = Join-Path $cache 'installer.exe'
    if (Test-Path -LiteralPath $cachedInstaller) {
        $expectedHashes = @(@($first, $second) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | ForEach-Object { (Get-FileHash -LiteralPath $_).Hash })
        if (@(Get-ChildItem -LiteralPath $cache -Force).Count -eq 1 -and $expectedHashes -contains (Get-FileHash -LiteralPath $cachedInstaller).Hash) {
            if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($cache)) -ne [IO.Path]::GetFullPath($env:LOCALAPPDATA)) { throw 'Unsafe test cache cleanup path' }
            Remove-Item -LiteralPath $cachedInstaller
            Remove-Item -LiteralPath $cache
        } else { Write-Warning "Retained unrecognized test cache content at $cache" }
    }
    # Keep the isolated directory for diagnostics. Never delete a computed install tree.
    Write-Output "Isolated installer test files: $root"
}
