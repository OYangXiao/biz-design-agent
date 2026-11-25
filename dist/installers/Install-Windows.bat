@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%..\harness-plugin\.claude-plugin\plugin.json" (
  for %%I in ("%SCRIPT_DIR%..\harness-plugin") do set "PLUGIN_SRC=%%~fI"
  for %%I in ("%SCRIPT_DIR%..\dsh-bundle") do set "DSH_SRC=%%~fI"
) else if exist "%SCRIPT_DIR%harness-plugin\.claude-plugin\plugin.json" (
  set "PLUGIN_SRC=%SCRIPT_DIR%harness-plugin"
  set "DSH_SRC=%SCRIPT_DIR%dsh-bundle"
) else (
  echo [ERROR] 未找到 harness-plugin 目录，请完整解压安装包后再双击运行。
  pause
  exit /b 1
)

set "FIGMA_SRC=%PLUGIN_SRC%\runtime\plugin"
set "DEFAULT_FIGMA_DIR=%USERPROFILE%\Documents\BizDesignAgent-FigmaPlugin"

echo ============================================================
echo   Biz Design Agent (v1.5.1) - Windows 一键安装向导
echo ============================================================
echo.

if exist "%USERPROFILE%\.biz-design-agent\runtime\node\node.exe" (
  for /f "delims=" %%v in ('"%USERPROFILE%\.biz-design-agent\runtime\node\node.exe" -v') do echo [OK] 已检测到便携版 Node.js: %%v
) else (
  where node >nul 2>nul
  if !ERRORLEVEL!==0 (
    for /f "delims=" %%v in ('node -v') do echo [OK] 已检测到 Node.js: %%v
  ) else (
    echo [WARN] 未检测到 Node.js，请确保已安装 Node ^>= 18（若仅使用 DeepSeek Harness 桌面端可跳过）。
  )
)
echo.

if exist "%USERPROFILE%\.gemini" (
  echo [INFO] 正在安装到 Antigravity (%USERPROFILE%\.gemini\config\plugins\biz-design-agent)...
  if not exist "%USERPROFILE%\.gemini\config\plugins" mkdir "%USERPROFILE%\.gemini\config\plugins"
  if exist "%USERPROFILE%\.gemini\config\plugins\biz-design-agent" rmdir /s /q "%USERPROFILE%\.gemini\config\plugins\biz-design-agent"
  xcopy /E /I /Y /Q "%PLUGIN_SRC%" "%USERPROFILE%\.gemini\config\plugins\biz-design-agent" >nul
  > "%USERPROFILE%\.gemini\config\plugins\biz-design-agent\mcp_config.json" (
    echo {
    echo   "mcpServers": {
    echo     "biz-design-agent": {
    echo       "command": "cmd.exe",
    echo       "args": ["/c", "${PLUGIN_ROOT}\scripts\run-mcp.cmd"]
    echo     }
    echo   }
    echo }
  )
  echo [OK] Antigravity 插件安装完成（已自动适配 Windows 启动器）
)

if exist "%USERPROFILE%\.claude" (
  echo [INFO] 正在安装到 Claude Code (%USERPROFILE%\.claude\skills\biz-design-agent)...
  if not exist "%USERPROFILE%\.claude\skills" mkdir "%USERPROFILE%\.claude\skills"
  if exist "%USERPROFILE%\.claude\skills\biz-design-agent" rmdir /s /q "%USERPROFILE%\.claude\skills\biz-design-agent"
  xcopy /E /I /Y /Q "%PLUGIN_SRC%" "%USERPROFILE%\.claude\skills\biz-design-agent" >nul
  echo [OK] Claude Code 插件安装完成（新开会话自动生效）
)

if exist "%USERPROFILE%\.cursor" (
  echo [INFO] 正在安装到 Cursor (%USERPROFILE%\.cursor\plugins\biz-design-agent)...
  if not exist "%USERPROFILE%\.cursor\plugins" mkdir "%USERPROFILE%\.cursor\plugins"
  if exist "%USERPROFILE%\.cursor\plugins\biz-design-agent" rmdir /s /q "%USERPROFILE%\.cursor\plugins\biz-design-agent"
  xcopy /E /I /Y /Q "%PLUGIN_SRC%" "%USERPROFILE%\.cursor\plugins\biz-design-agent" >nul
  echo [OK] Cursor 插件目录已就绪
)

if exist "%USERPROFILE%\.dsh" (
  echo.
  echo [INFO] 检测到 DeepSeek Harness！
  echo        请在左侧点击「Plugins -^> Add plugin」，粘贴以下目录回车即可启用：
  echo        %DSH_SRC%
)

echo.
echo ------------------------------------------------------------
echo 第二步：复制 Figma 桌面端桥接插件（全局仅需导入一次）
echo 默认可见目录：%DEFAULT_FIGMA_DIR%
set "USER_FIGMA_DIR="
set /p "USER_FIGMA_DIR=直接按回车使用默认目录，或输入自定义路径（输入 skip 跳过）: "

if /i not "%USER_FIGMA_DIR%"=="skip" (
  if "%USER_FIGMA_DIR%"=="" (
    set "TARGET_FIGMA_DIR=%DEFAULT_FIGMA_DIR%"
  ) else (
    set "TARGET_FIGMA_DIR=%USER_FIGMA_DIR%"
  )
  if not exist "!TARGET_FIGMA_DIR!" mkdir "!TARGET_FIGMA_DIR!"
  copy /Y "%FIGMA_SRC%\manifest.json" "!TARGET_FIGMA_DIR!\" >nul
  copy /Y "%FIGMA_SRC%\code.js" "!TARGET_FIGMA_DIR!\" >nul
  copy /Y "%FIGMA_SRC%\ui.html" "!TARGET_FIGMA_DIR!\" >nul
  echo [OK] Figma 插件已复制到：!TARGET_FIGMA_DIR!
  explorer /select,"!TARGET_FIGMA_DIR!\manifest.json"
  echo.
  echo 接下来请在 Figma Desktop 中完成 3 步：
  echo   1. 打开任意设计稿
  echo   2. 菜单：Plugins -^> Development -^> Import plugin from manifest...
  echo   3. 选中刚高亮的 manifest.json，然后运行 Biz Design Agent 插件即可！
)

echo.
echo 全部完成！重启或新开 AI 客户端后，发送「打开 biz-design-agent 主菜单」即可使用。
pause
