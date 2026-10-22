param([string]$Checkpoint = 'after')
$ErrorActionPreference = 'Continue'
$folder = Join-Path 'work/windows-audio-diagnostics' $Checkpoint
New-Item -ItemType Directory -Path $folder -Force | Out-Null
Get-Service Audiosrv,AudioEndpointBuilder | Format-List * | Out-File "$folder/services.txt"
Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -in @('MEDIA','AudioEndpoint') -or $_.Name -match 'CABLE|VB-Audio' } | Format-List Name,Status,ConfigManagerErrorCode,PNPDeviceID,Service,HardwareID | Tee-Object -FilePath "$folder/devices.txt"
Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceClass -eq 'MEDIA' -or $_.DeviceName -match 'CABLE|VB-Audio' } | Format-List DeviceName,DriverVersion,InfName,IsSigned,Signer | Out-File "$folder/signatures.txt"
pnputil /enum-devices /class MEDIA /drivers | Out-File "$folder/pnp-media.txt"
pnputil /enum-devices /class AudioEndpoint /drivers | Out-File "$folder/pnp-endpoints.txt"
pnputil /enum-drivers /class MEDIA /files | Out-File "$folder/driver-store.txt"
Copy-Item -LiteralPath "$env:windir/INF/setupapi.dev.log" -Destination "$folder/setupapi.dev.log"
Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational';StartTime=(Get-Date).AddMinutes(-20)} -ErrorAction SilentlyContinue | Format-List TimeCreated,Id,Message | Out-File "$folder/code-integrity.txt"
Get-Process -Id $PID | Select-Object Id,SessionId,Path | Format-List | Out-File "$folder/session.txt"
whoami /all | Out-File "$folder/identity.txt"
Get-ItemProperty 'HKLM:/SYSTEM/CurrentControlSet/Control/Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue | Format-List | Out-File "$folder/reboot.txt"
if ($env:ACROCLIP_AUDIO_FIXTURE_ROOT) { Copy-Item -Path "$env:ACROCLIP_AUDIO_FIXTURE_ROOT/*.log" -Destination $folder -ErrorAction SilentlyContinue }
exit 0
