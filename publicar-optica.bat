@echo off
chcp 65001 >nul 2>&1
title RUBI LENS — Publicar Tienda Online (Vercel)
color 0E

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║    RUBI LENS — Publicar Tienda Online (Vercel)   ║
echo  ╚══════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

echo [1/4] Directorio: %cd%
echo.

echo [2/4] Verificando cambios pendientes en develop...
git checkout develop
if %errorlevel% neq 0 (
    color 0C
    echo ERROR: No se pudo cambiar a develop.
    pause
    exit /b 1
)
git status --short
echo.

echo [3/4] Agregando y creando commit...
git add -A
git diff --cached --quiet 2>nul
if %errorlevel% neq 0 (
    for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set FECHA=%%c-%%a-%%b
    for /f "tokens=1-2 delims=: " %%a in ('time /t') do set HORA=%%a:%%b
    git commit -m "rubilens: actualización %FECHA% %HORA%"
    echo    → Commit creado.
) else (
    echo    → Sin cambios nuevos.
)
echo.

echo [4/4] Subiendo a GitHub (develop → Vercel)...
git push origin develop
echo.

if %errorlevel% equ 0 (
    color 0A
    echo  ╔══════════════════════════════════════════════════╗
    echo  ║   ✓ rubilens.com se actualizará en ~1 minuto     ║
    echo  ╚══════════════════════════════════════════════════╝
) else (
    color 0C
    echo  ╔══════════════════════════════════════════════════╗
    echo  ║   ✗ Error al subir. Revisa la conexión o token   ║
    echo  ╚══════════════════════════════════════════════════╝
)

echo.
pause
