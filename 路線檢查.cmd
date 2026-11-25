@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto launch_failed

rem Keep this file ASCII with CRLF for reliable Windows batch parsing.
set "VALIDATOR_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do call :try_node "%%N"
if not defined VALIDATOR_NODE call :try_node "%ProgramFiles%\nodejs\node.exe"
if not defined VALIDATOR_NODE call :try_node "%LocalAppData%\Programs\nodejs\node.exe"
if not defined VALIDATOR_NODE call :try_node "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined VALIDATOR_NODE goto missing_node

echo Starting Mountain Planner Route Validator...
echo Keep this window open while using the tool.
echo Node: %VALIDATOR_NODE%
echo.
"%VALIDATOR_NODE%" "%~dp0tools\route-validator.mjs" serve %*
if errorlevel 1 goto launch_failed
exit /b 0

:try_node
if defined VALIDATOR_NODE exit /b 0
if not exist "%~1" exit /b 0
"%~1" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>nul
if errorlevel 1 exit /b 0
set "VALIDATOR_NODE=%~1"
exit /b 0

:missing_node
echo Node.js 24 or newer was not found.
echo Please install Node.js from https://nodejs.org/ and try again.
echo.
pause
exit /b 1

:launch_failed
echo.
echo Route Validator could not start. Keep this message for troubleshooting.
pause
exit /b 1
