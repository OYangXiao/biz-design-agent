@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "AGENT_ENTRY=%SCRIPT_DIR%..\runtime\bin\biz-design-agent.mjs"

if exist "%USERPROFILE%\.biz-design-agent\runtime\node\node.exe" (
  "%USERPROFILE%\.biz-design-agent\runtime\node\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
if exist "%NVM_SYMLINK%\node.exe" (
  "%NVM_SYMLINK%\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
  "%LOCALAPPDATA%\Programs\nodejs\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\node.exe" (
  "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
where node >nul 2>nul
if %ERRORLEVEL%==0 (
  node "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)

echo biz-design-agent: Node.js ^>= 18 not found. Please install Node LTS or portable Node. 1>&2
exit /b 1
