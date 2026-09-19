@echo off
REM ==================================================
REM  QEFT Bridge extension - remove policy install
REM ==================================================

echo.
reg delete "HKCU\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /f >nul 2>&1
if errorlevel 1 (echo [--] Chrome : nothing to remove) else (echo [OK] Chrome : policy removed)

reg delete "HKCU\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 1 /f >nul 2>&1
if errorlevel 1 (echo [--] Edge   : nothing to remove) else (echo [OK] Edge   : policy removed)

reg delete "HKCU\Software\Policies\BraveSoftware\Brave\ExtensionInstallForcelist" /v 1 /f >nul 2>&1
if errorlevel 1 (echo [--] Brave  : nothing to remove) else (echo [OK] Brave  : policy removed)

echo.
echo Restart your browser, the extension will be removed.
echo.
pause
