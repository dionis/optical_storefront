@echo off
chcp 65001 >nul 2>&1
title RUBI LENS — Publicar BACKEND (Coolify)
color 0B

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║     RUBI LENS — Publicar BACKEND (Coolify)       ║
echo  ╚══════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ── Paso 1: Asegurar que develop está al día ──
echo [1/6] Verificando cambios en develop...
git add -A
git diff --cached --quiet 2>nul
if %errorlevel% neq 0 (
    for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set FECHA=%%c-%%a-%%b
    for /f "tokens=1-2 delims=: " %%a in ('time /t') do set HORA=%%a:%%b
    git commit -m "actualización %FECHA% %HORA%"
    git push origin develop
    echo    → Cambios de develop subidos.
) else (
    echo    → develop limpio.
)
echo.

:: ── Paso 2: Cambiar a main ──
echo [2/6] Cambiando a rama main...
git checkout main
if %errorlevel% neq 0 (
    color 0C
    echo ERROR: No se pudo cambiar a main.
    pause
    exit /b 1
)
echo.

:: ── Paso 3: Merge develop → main ──
echo [3/6] Fusionando develop en main...
git merge develop --no-edit
if %errorlevel% neq 0 (
    color 0C
    echo ERROR: Conflicto en el merge. Resuélvelo manualmente.
    pause
    exit /b 1
)
echo.

:: ── Paso 4: Push main (dispara Coolify) ──
echo [4/6] Subiendo main a GitHub (→ Coolify)...
git push origin main
echo.

:: ── Paso 5: Volver a develop ──
echo [5/6] Volviendo a develop...
git checkout develop
echo.

:: ── Paso 6: Resultado ──
echo [6/6] Listo.
echo.

if %errorlevel% equ 0 (
    color 0A
    echo  ╔══════════════════════════════════════════════════╗
    echo  ║   ✓ Backend publicado. Coolify desplegará pronto ║
    echo  ╚══════════════════════════════════════════════════╝
) else (
    color 0C
    echo  ╔══════════════════════════════════════════════════╗
    echo  ║   ✗ Hubo un error. Revisa los mensajes arriba    ║
    echo  ╚══════════════════════════════════════════════════╝
)

echo.
pause
