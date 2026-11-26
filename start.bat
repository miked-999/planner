@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\uvicorn.exe" (
    echo Backend environment not found - running first-time setup ...
    call "%~dp0setup.bat"
    if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
)

if not exist "frontend\dist\index.html" (
    where npm >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo Building frontend bundle ...
        call npm --prefix frontend install
        call npm --prefix frontend run build
    ) else (
        echo [WARNING] frontend\dist\index.html is missing and npm is not installed.
        echo Copy frontend\dist from another machine or install Node.js and run setup.bat.
    )
)

echo Starting Project ^& Resource Planner at http://127.0.0.1:8000 ...
echo Press Ctrl+C in this window to stop the server.
start "" http://127.0.0.1:8000
"backend\.venv\Scripts\uvicorn.exe" app.main:app --app-dir "%~dp0backend" --host 127.0.0.1 --port 8000
endlocal
