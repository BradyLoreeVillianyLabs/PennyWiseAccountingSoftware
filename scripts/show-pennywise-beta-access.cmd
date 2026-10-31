@echo off
setlocal

rem This launcher is deliberately free of PowerShell execution-policy requirements.
rem It delegates credential storage and redaction to the active PennyWise utility.
node "%~dp0pennywise-beta-access.mjs" access %*

endlocal
