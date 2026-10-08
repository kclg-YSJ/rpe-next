@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\vite\package.json" (
  echo First run: installing dependencies, this may take a few minutes...
  call npm install
  if errorlevel 1 (
    echo Could not install dependencies. Check your network and try again.
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 pause
