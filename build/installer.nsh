; Keep manual installer upgrades in their established scope and directory.
; Portable packages do not load this include. App onboarding uses preferences.json.
!include LogicLib.nsh
!ifdef allowToChangeInstallationDirectory
  !undef allowToChangeInstallationDirectory
!endif

!ifndef BUILD_UNINSTALLER
  Var acroclipUpgrade

  !macro customInit
    StrCpy $acroclipUpgrade "0"
    ${if} $hasPerUserInstallation == "1"
    ${andif} $hasPerMachineInstallation == "0"
    ${andif} ${FileExists} "$perUserInstallationFolder\${APP_EXECUTABLE_FILENAME}"
      StrCpy $acroclipUpgrade "1"
      StrCpy $INSTDIR $perUserInstallationFolder
    ${elseif} $hasPerMachineInstallation == "1"
    ${andif} $hasPerUserInstallation == "0"
    ${andif} ${FileExists} "$perMachineInstallationFolder\${APP_EXECUTABLE_FILENAME}"
      StrCpy $acroclipUpgrade "1"
      StrCpy $INSTDIR $perMachineInstallationFolder
    ${endif}
    ${if} $acroclipUpgrade == "1"
      !insertmacro GetDParameter $R0
      ${if} $R0 != ""
      ${andif} $R0 != $INSTDIR
        MessageBox MB_OK|MB_ICONSTOP "AcroClip is already installed in $INSTDIR. Upgrade there, or uninstall it before choosing another folder."
        SetErrorLevel 2
        Quit
      ${endif}
    ${endif}
  !macroend

  !macro customInstallMode
    ${if} $acroclipUpgrade == "1"
      ${if} $installMode == "all"
        StrCpy $isForceMachineInstall "1"
      ${else}
        StrCpy $isForceCurrentInstall "1"
      ${endif}
    ${endif}
  !macroend

  ; The builder's directory page also appends a product folder to custom paths.
  ; This page preserves an existing path exactly, including older custom names.
  !macro customPageAfterChangeDir
    !include StrContains.nsh
    Function acroclipDirectoryPre
      ${if} $acroclipUpgrade == "1"
      ${orif} ${isUpdated}
        Abort
      ${endif}
    FunctionEnd
    !define MUI_PAGE_CUSTOMFUNCTION_PRE acroclipDirectoryPre
    !insertmacro MUI_PAGE_DIRECTORY

    ; Keep the builder's first-install folder protection without rewriting an
    ; established custom directory during an upgrade.
    Function acroclipInstallFilesPre
      ${if} $acroclipUpgrade != "1"
      ${andifNot} ${isUpdated}
      ${andifNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
        ${if} $0 == ""
          StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
        ${endif}
      ${endif}
    FunctionEnd
    !define MUI_PAGE_CUSTOMFUNCTION_PRE acroclipInstallFilesPre
  !macroend
!endif
