@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   零件拉动控制塔 v2  启动中...
echo ============================================
echo.
echo   SMTP邮件服务: 已配置
echo   打开浏览器: http://localhost:3456/control-tower.html
echo.
echo   关闭此窗口即可停止服务
echo ============================================
echo.
start "" http://localhost:3456/control-tower.html
"%~dp0portable-node\node.exe" "%~dp0server.js"
pause
