param([switch]$PlayTone, [string]$TonePath, [switch]$EndpointOnly)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:ACROCLIP_HOSTED_WINDOWS_FIXTURE -ne 'github-hosted') {
    throw 'This audio fixture may run only in a disposable GitHub-hosted Windows job'
}
if ($PlayTone) {
    $player = [System.Media.SoundPlayer]::new($TonePath)
    $player.Load()
    $player.PlayLooping()
    try { while ($true) { Start-Sleep -Seconds 1 } } finally { $player.Stop(); $player.Dispose() }
    exit
}

# Test infrastructure only. VB-CABLE is donationware from https://vb-audio.com/Cable/.
# Download the unchanged package into the disposable runner, never the app payload.
$fixture = Join-Path $env:RUNNER_TEMP ('acroclip-audio-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
"ACROCLIP_AUDIO_FIXTURE_ROOT=$fixture" | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8
$archive = Join-Path $fixture 'VBCABLE_Driver_Pack45.zip'
Invoke-WebRequest -Uri 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip' -OutFile $archive -TimeoutSec 60
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne 'B950E39F01AF1D04EA623C8F6D8EB9B6EA5C477C637295FABF20631C85116BFB') {
    throw 'The pinned audio fixture archive differs'
}
$driver = Join-Path $fixture 'driver'
Expand-Archive -LiteralPath $archive -DestinationPath $driver
$installer = Join-Path $driver 'VBCABLE_Setup_x64.exe'
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne 'A77952D93229D0EC36E2543081EEA7D125732B9C') {
    throw 'The audio fixture installer signature differs'
}
$catalog = Get-AuthenticodeSignature -LiteralPath (Join-Path $driver 'vbaudio_cable64_win10.cat')
if ($catalog.Status -ne 'Valid' -or $catalog.SignerCertificate.Subject -notlike 'CN=Microsoft Windows Hardware Compatibility Publisher,*') {
    throw 'The audio fixture requires a valid Microsoft hardware catalog signature'
}
Set-Service AudioEndpointBuilder -StartupType Manual
Set-Service Audiosrv -StartupType Manual
Start-Service AudioEndpointBuilder
Start-Service Audiosrv
$installation = Start-Process -FilePath $installer -ArgumentList '-i', '-h' -WorkingDirectory $driver -WindowStyle Hidden -PassThru
if (-not $installation.WaitForExit(60000)) { $installation.Kill(); throw 'Audio fixture installation timed out' }
Write-Output "Audio fixture installer exited $($installation.ExitCode)"
Add-Type -Path (Join-Path $PSScriptRoot 'windows-audio-endpoint.cs')
$deadline = [DateTime]::UtcNow.AddSeconds(30)
do {
    $endpoints = @()
    try {
        $identity = [AudioFixtureEndpoint]::DefaultRenderIdentity()
        # PnP calls this endpoint "Speakers"; its Core Audio friendly name is
        # "CABLE Input". Match its actual identity instead of either label.
        $endpoints = @(Get-CimInstance Win32_PnPEntity | Where-Object {
            $_.PNPDeviceID -eq "SWD\MMDEVAPI\$identity" -and $_.Name -like '*VB-Audio Virtual Cable*' -and $_.ConfigManagerErrorCode -eq 0
        })
    } catch { Write-Output "Waiting for the default render endpoint: $($_.Exception.Message)" }
    if ($endpoints.Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)
if ($endpoints.Count -eq 0) { throw 'The signed virtual audio output did not become active; capture verification remains blocked' }
$endpoints | Format-Table Status, Name, PNPDeviceID
"ACROCLIP_TEST_RENDER_ENDPOINT_ID=$identity" | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8
if ($EndpointOnly) { exit 0 }

# One second of independent 997 Hz PCM. Keep it playing through the actual
# Windows render endpoint throughout unpacked, portable and installed tests.
$tone = Join-Path $fixture 'tone.wav'
$writer = [IO.BinaryWriter]::new([IO.File]::Create($tone))
try {
    $writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $writer.Write([int]96036)
    $writer.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $writer.Write([int]16)
    $writer.Write([int16]1); $writer.Write([int16]1); $writer.Write([int]48000)
    $writer.Write([int]96000); $writer.Write([int16]2); $writer.Write([int16]16)
    $writer.Write([Text.Encoding]::ASCII.GetBytes('data')); $writer.Write([int]96000)
    for ($sample = 0; $sample -lt 48000; $sample++) { $writer.Write([int16](3276 * [Math]::Sin(2 * [Math]::PI * 997 * $sample / 48000))) }
} finally { $writer.Dispose() }
$toneProcess = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList '-NoProfile', '-File', ('"{0}"' -f $PSCommandPath), '-PlayTone', '-TonePath', ('"{0}"' -f $tone) -WindowStyle Hidden -PassThru
"ACROCLIP_AUDIO_FIXTURE_PID=$($toneProcess.Id)" | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8
if ($toneProcess.WaitForExit(1000)) { throw "The private audio producer exited $($toneProcess.ExitCode)" }
'ACROCLIP_PACKAGED_PRIVATE_AUDIO=1' | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8
