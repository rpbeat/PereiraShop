@echo off
rem Duplo clique para abrir o painel de catalogo Yupoo
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py painel.py) else (python painel.py)
pause
