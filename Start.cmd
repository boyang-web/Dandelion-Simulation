@echo off
setlocal
pushd "%~dp0" || exit /b 1
where py >nul 2>nul
if errorlevel 1 goto usepython
py -3 tools\serve_local.py --launch
goto finish
:usepython
where python >nul 2>nul
if errorlevel 1 goto missing
python tools\serve_local.py --launch
goto finish
:missing
echo Install Python 3 for Windows, then reopen Start.cmd.
pause
popd
exit /b 1
:finish
if errorlevel 1 pause
popd
