@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo =========================================
echo   TWODRAPES data import
echo =========================================
echo.

REM Check Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  exit /b 1
)

REM Find backup file: argument > latest in data/
set "BACKUP_FILE=%~1"
if defined BACKUP_FILE (
  if not exist "%BACKUP_FILE%" (
    echo File not found: %BACKUP_FILE%
    exit /b 1
  )
  goto confirm
)

REM Auto-find latest backup in data/
set "BACKUP_FILE="
for /f "delims=" %%f in ('dir /b /o-d data\twodrapes_backup_*.json 2^>nul') do (
  if not defined BACKUP_FILE set "BACKUP_FILE=data\%%f"
)

REM Also check current directory
if not defined BACKUP_FILE (
  for /f "delims=" %%f in ('dir /b /o-d twodrapes_backup_*.json 2^>nul') do (
    if not defined BACKUP_FILE set "BACKUP_FILE=%%f"
  )
)

if not defined BACKUP_FILE (
  echo No data backup found.
  echo.
  echo Usage:
  echo   import-data.cmd                          Auto-find latest backup
  echo   import-data.cmd path\to\backup.json      Import specific file
  echo.
  echo To create a backup from another server, run:
  echo   node scripts\export-data.js
  exit /b 1
)

:confirm
echo Backup file: %BACKUP_FILE%
echo.
set /p CONFIRM="Import this data? This will overwrite existing records. (Y/N): "
if /i not "%CONFIRM%"=="Y" (
  echo Import cancelled.
  exit /b 0
)

echo.
echo Importing...
node scripts\import-data.js "%BACKUP_FILE%"
if errorlevel 1 (
  echo.
  echo Import failed.
  exit /b 1
)

echo.
echo =========================================
echo   Import complete
echo =========================================
echo.
echo   If the server is running, data is available immediately.
echo   If not, start the server with: node server.js
echo.
