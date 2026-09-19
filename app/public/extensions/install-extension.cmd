@echo off
REM ==================================================
REM  QEFT Bridge extension - one-click install (diag)
REM  v2: shows real reg.exe errors, falls back to PowerShell.
REM ==================================================

set EXT_ID=bflfbjgpjlhhgajeimapcodifjhmaloo
set UPDATE_URL=https://flash.geekhonize.top/extensions/updates.xml

echo.
echo == QEFT Bridge one-click install (diagnostic) ==
echo  Ext ID : %EXT_ID%
echo  Update : %UPDATE_URL%
echo  User   : %USERNAME%  Session: %SESSIONNAME%
echo.

echo [1/3] Chrome ...
reg add "HKCU\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /d "%EXT_ID%;%UPDATE_URL%" /f 2>&1
if errorlevel 1 (
  echo [--] reg.exe failed, trying PowerShell ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { New-Item -Path 'HKCU:\Software\Policies\Google\Chrome\ExtensionInstallForcelist' -Force -ErrorAction Stop | Out-Null; Set-ItemProperty -Path 'HKCU:\Software\Policies\Google\Chrome\ExtensionInstallForcelist' -Name '1' -Value '%EXT_ID%;%UPDATE_URL%' -ErrorAction Stop; Write-Host '  [OK] Chrome via PowerShell' } catch { Write-Host ('  [--] Chrome PS: ' + $_.Exception.Message) }"
) else (
  echo  [OK] Chrome : policy written
)

echo [2/3] Edge ...
reg add "HKCU\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 1 /d "%EXT_ID%;%UPDATE_URL%" /f 2>&1
if errorlevel 1 (
  echo [--] reg.exe failed, trying PowerShell ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { New-Item -Path 'HKCU:\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist' -Force -ErrorAction Stop | Out-Null; Set-ItemProperty -Path 'HKCU:\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist' -Name '1' -Value '%EXT_ID%;%UPDATE_URL%' -ErrorAction Stop; Write-Host '  [OK] Edge via PowerShell' } catch { Write-Host ('  [--] Edge PS: ' + $_.Exception.Message) }"
) else (
  echo  [OK] Edge : policy written
)

echo [3/3] Brave ...
reg add "HKCU\Software\Policies\BraveSoftware\Brave\ExtensionInstallForcelist" /v 1 /d "%EXT_ID%;%UPDATE_URL%" /f 2>&1
if errorlevel 1 (
  echo [--] reg.exe failed, trying PowerShell ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { New-Item -Path 'HKCU:\Software\Policies\BraveSoftware\Brave\ExtensionInstallForcelist' -Force -ErrorAction Stop | Out-Null; Set-ItemProperty -Path 'HKCU:\Software\Policies\BraveSoftware\Brave\ExtensionInstallForcelist' -Name '1' -Value '%EXT_ID%;%UPDATE_URL%' -ErrorAction Stop; Write-Host '  [OK] Brave via PowerShell' } catch { Write-Host ('  [--] Brave PS: ' + $_.Exception.Message) }"
) else (
  echo  [OK] Brave : policy written
)

echo.
echo ---- verify ----
reg query "HKCU\Software\Policies\Google\Chrome\ExtensionInstallForcelist" 2>&1
reg query "HKCU\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" 2>&1

echo.
echo If values above show your policy, FULLY close and reopen the browser.
echo If all writes failed with Access denied, right-click this .cmd and
echo choose "Run as administrator", then run remove-extension.cmd later to undo.
echo.
pause
