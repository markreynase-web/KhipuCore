@echo off
REM Doble clic: levanta el backend, sirve el frontend y abre el login en el navegador.
title Panel de Datos - Lanzador
cd /d "%~dp0"

echo Iniciando backend (puerto 3001)...
start "Backend - Panel de Datos" cmd /k "cd /d "%~dp0backend" && npm run dev"

echo Iniciando frontend (puerto 3000)...
start "Frontend - Panel de Datos" cmd /k "cd /d "%~dp0" && npx serve -l 3000"

echo Esperando a que los servidores arranquen...
timeout /t 3 /nobreak >nul

start "" "http://localhost:3000/pages/login.html"
