@echo off
chcp 65001 >nul 2>&1
title ÓPTICA EL RANCHO — Publicar Panel Admin (Vercel Preview)
color 0A

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║  ÓPTICA EL RANCHO — Publicar Panel (Vercel)      ║
echo  ╚══════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

echo [1/4] Directorio: %cd%
echo.

echo [2/4] Cambiando a rama develop_optical_storepos...
git checkout develop_optical_storepos
if %errorlevel% neq 0 (
    color 0C
    echo ERROR: No se pudo cambiar a develop_optical_storepos.
    echo Verifica que la rama existe: git branch -a
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
    git commit -m "elrancho: actualización %FECHA% %HORA%"
    echo    → Commit creado.
) else (
    echo    → Sin cambios nuevos.
)
echo.

echo [4/4] Subiendo a GitHub (develop_optical_storepos → Vercel Preview)...
git push origin develop_optical_storepos
echo.

if %errorlevel% equ 0 (
    color 0A
    echo  ╔══════════════════════════════════════════════════╗
    echo  ║   ✓ Panel El Rancho se actualizará en ~1 minuto  ║
    echo  ╚══════════════════════════════════════════════════╝
) else (
    color 0C
    echo  ╔══════════════════════════════════════════════════╗
    echo  ║   ✗ Error al subir. Revisa la conexión o token   ║
    echo  ╚══════════════════════════════════════════════════╝
)

echo.
echo  URL del preview:
echo  https://optical-storefront-cap-git-9852ba-dacostar85work-5355s-projects.vercel.app/
echo.
pause
