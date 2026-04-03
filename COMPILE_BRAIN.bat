@echo off
chcp 65001 >nul 2>&1
title FLOWORKOS Brain Compiler v6

echo.
echo ============================================
echo   FLOWORKOS Brain Compiler v6
echo   Full Binary Encoding (V8 + XOR)
echo ============================================
echo.
echo   .js files  = V8 Bytecode (.jsc)
echo   .ts/.tsx   = XOR Binary Encoding
echo   .json/.md  = XOR Binary Encoding
echo   ALL files  = Fully encoded (unreadable)
echo.
echo ============================================
echo.

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Install Node.js first.
    pause
    exit /b 1
)

REM Check brain/ folder
if not exist "%~dp0brain" (
    echo [ERROR] brain/ folder not found!
    echo Make sure you run this from the ENGINE directory.
    pause
    exit /b 1
)

REM Check adm-zip
node -e "require('adm-zip')" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INSTALL] Installing adm-zip ...
    cd /d "%~dp0"
    npm install adm-zip --save
)

echo [START] Compiling brain/ to brain.zip ...
echo.

cd /d "%~dp0"
node scripts\compile_brain.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Compilation failed!
    pause
    exit /b 1
)

echo.
echo [SUCCESS] brain.zip is ready!
echo.
echo Files inside brain.zip are fully encoded:
echo   - .jsc files = V8 Bytecode (binary)
echo   - Other files = XOR Encoded (binary)
echo   - Only 6 UI scripts remain plain JS
echo.
echo The app will auto-decode on startup.
echo.
pause
