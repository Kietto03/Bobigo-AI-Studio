@echo off
title Bobigo AI Studio 2.0
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File .\run.ps1 %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Script ended with error code %ERRORLEVEL%.
    pause
)
