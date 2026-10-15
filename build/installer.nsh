; Registers CAMBOT Camera with Windows during install, and removes it on uninstall.
; The installer runs with administrator rights (perMachine), so no extra prompt is needed.
; Sysnative reaches the 64-bit regsvr32 from the 32-bit installer.

!macro customInstall
  ExecWait '"$WINDIR\Sysnative\regsvr32.exe" /s "$INSTDIR\resources\camera\cambot_camera.dll"'
!macroend

!macro customUnInstall
  ExecWait '"$WINDIR\Sysnative\regsvr32.exe" /s /u "$INSTDIR\resources\camera\cambot_camera.dll"'
!macroend
