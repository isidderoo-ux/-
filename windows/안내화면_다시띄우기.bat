@echo off
rem Show the message screen again if it is outside attendance time
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0check.ps1"
