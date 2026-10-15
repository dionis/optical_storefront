@echo off
chcp 65001 >nul 2>&1
title RUBI LENS — Publicar actualizaciones
color 0E

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║        RUBI LENS — Publicar actualizaciones      ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: ── Paso 1: Ir al directorio del proyecto ──
cd /d "%~dp0"
echo [1/5] Directorio: %cd%
echo.

:: ── Paso 2: Estado de git ──
echo [2/5] Verificando cambios pendientes...
git status --short
echo.

:: ── Paso 3: Añadir todos los cambios ──
echo [3/5] Agregando archivos modificados...
git add -A
echo.

:: ── Paso 4: Commit con fecha y hora ──
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set FECHA=%%c-%%a-%%b
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set HORA=%%a:%%b
echo [4/5] Creando commit...
git commit -m "actualización %FECHA% %HORA%"
echo.

:: ── Paso 5: Push a develop (Vercel storefront) ──
echo [5/5] Subiendo a GitHub (develop → Vercel)...
git push origin develop
echo.

if %errorlevel% equ 0 (
    color 0A
    echo  ╔══════════════════════════════════════════════════╗
    echo  ║   ✓ ¡Publicado! Vercel desplegará en ~1 minuto   ║
    echo  ╚══════════════════════════════════════════════════╝
) else (
    color 0C
    echo  ╔══════════════════════════════════════════════════╗
    echo  ║   ✗ Error al subir. Revisa la conexión o token   ║
    echo  ╚══════════════════════════════════════════════════╝
)

echo.
echo  Para actualizar el BACKEND (Coolify), ejecuta también:
echo    git checkout main
echo    git merge develop
echo    git push origin main
echo    git checkout develop
echo.
pause
