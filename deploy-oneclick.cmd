@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set PORT=8080
set FACTORY_PORT=8081
set AMAZON_PORT=8082
set HOST=0.0.0.0

echo =========================================
echo   TWODRAPES one-click deployment
echo =========================================
echo.

echo [1/6] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Please install Node.js 22+ or 24+ from https://nodejs.org/
  exit /b 1
)
for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo Node.js version is too old. Please install Node.js 22+ or 24+.
  exit /b 1
)
node -v

echo.
echo [2/6] Installing dependencies...
if exist package-lock.json (
  call npm ci --omit=dev
) else (
  call npm install --omit=dev
)
if errorlevel 1 exit /b 1

echo.
echo [3/6] Preparing environment...
if not exist data mkdir data
if not exist data\backups mkdir data\backups
if not exist data\exports mkdir data\exports
if not exist data\delivery-screenshots mkdir data\delivery-screenshots
if not exist .env (
  > .env echo PORT=%PORT%
  >> .env echo FACTORY_PORT=%FACTORY_PORT%
  >> .env echo AMAZON_PORT=%AMAZON_PORT%
  >> .env echo HOST=%HOST%
  >> .env echo NO_AUTH=1
  >> .env echo PAYPAL_FEE_RATE=0.044
  >> .env echo USD_RMB_RATE=6.9
  echo .env created with local no-login access
) else (
  echo .env already exists
)

echo.
echo [4/6] Initializing database...
node scripts\init-db.js

echo.
echo [5/6] Data import...
REM Check if a backup JSON exists in data/
set "BACKUP_FILE="
for /f "delims=" %%f in ('dir /b /o-d data\twodrapes_backup_*.json 2^>nul') do (
  if not defined BACKUP_FILE set "BACKUP_FILE=data\%%f"
)
if not defined BACKUP_FILE (
  echo No data backup found. Starting with empty database.
  goto start_service
)
echo Found backup: %BACKUP_FILE%
echo.
set /p IMPORT_CHOICE="Import data from this backup? (Y/N): "
if /i "%IMPORT_CHOICE%"=="Y" (
  echo Importing data...
  node scripts\import-data.js "%BACKUP_FILE%"
  echo.
  echo Data imported successfully.
) else (
  echo Skipping data import. Starting with empty database.
  echo You can import later by running: import-data.cmd
)

:start_service
echo.
echo [6/6] Starting service...
start "TWODRAPES" cmd /k "node server.js"

echo.
echo =========================================
echo   Deployment complete
echo =========================================
echo.
echo   Shopify side:  http://localhost:%PORT%
echo   Factory side:  http://localhost:%FACTORY_PORT%
echo   Amazon side:   http://localhost:%AMAZON_PORT%
echo.
echo   To import data later, run: import-data.cmd
echo.
