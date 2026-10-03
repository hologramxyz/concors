; Hooks into Tauri's NSIS installer (bundle > windows > nsis > installerHooks).
;
; The installer closes Concors itself before replacing it, but the daemon runtime outlives the
; window on purpose: its session host keeps terminals alive across restarts, and agents and the
; speech worker run on the same bundled Node. Windows will not overwrite a running program, so
; while any of them runs, installing over the old copy fails at daemon\bin\node.exe. Before files
; are written or removed, every process started from this installation's daemon is stopped, which
; is what an update means for them on every platform. Node from anywhere else is left alone.
;
; The app is closed first, with Tauri's own check (which asks, unless the install is silent or
; passive): the hooks run just before that check, and an app still open would start its runtime
; again as soon as it saw it stop.

!macro ConcorsStopRuntime
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  ; Through the environment, so an apostrophe in the install path cannot break the command.
  System::Call 'Kernel32::SetEnvironmentVariable(t "CONCORS_INSTALL_DIR", t "$INSTDIR")'
  nsExec::Exec `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$runtime = Join-Path $$env:CONCORS_INSTALL_DIR 'daemon\'; $$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$runtime, [StringComparison]::OrdinalIgnoreCase) }; $$running | Stop-Process -Force -ErrorAction SilentlyContinue; $$running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue"`
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ConcorsStopRuntime
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ConcorsStopRuntime
!macroend
