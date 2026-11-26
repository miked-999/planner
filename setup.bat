@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo  Project ^& Resource Planner - Windows Setup
echo ===================================================

:: 1. Locate Python 3.11+
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "PY_CMD=python"
) else (
    where py >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set "PY_CMD=py -3"
    ) else (
        echo [ERROR] Python 3.11+ was not found on PATH.
        echo Install Python from https://www.python.org/downloads/ and re-run setup.bat.
        exit /b 1
    )
)

:: 2. Create backend virtual environment & install dependencies
if not exist "backend\.venv\Scripts\python.exe" (
    echo [1/2] Creating Python virtual environment in backend\.venv ...
    %PY_CMD% -m venv "backend\.venv"
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to create virtual environment.
        exit /b 1
    )
)

echo [1/2] Installing backend Python packages ...
"backend\.venv\Scripts\python.exe" -m pip install --upgrade pip >nul
"backend\.venv\Scripts\pip.exe" install -r "backend\requirements.txt"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install Python dependencies.
    exit /b 1
)

:: 3. Build frontend if npm is installed; otherwise check for pre-built frontend\dist
where npm >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [2/2] Installing frontend npm packages and building production bundle ...
    call npm --prefix frontend install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] npm install failed. If you copied node_modules from macOS, delete frontend\node_modules first.
        exit /b 1
    )
    call npm --prefix frontend run build
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Frontend build failed.
        exit /b 1
    )
) else (
    if exist "frontend\dist\index.html" (
        echo [2/2] Pre-built frontend\dist detected ^(Node.js/npm not required^).
    ) else (
        echo [WARNING] npm was not found and frontend\dist\index.html is missing.
        echo Either install Node.js ^(v20+^) and re-run setup.bat, OR copy the built frontend\dist folder from another machine.
    )
)

echo.
echo Setup complete! Run start.bat to launch the planner at http://127.0.0.1:8000
endlocal
