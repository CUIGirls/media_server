@echo off
echo.
echo 🎬 P2P Movie Streaming Platform Demo
echo =====================================
echo.
echo Starting the server...
start "P2P Server" cmd /k "cd /d %~dp0 && node backend/main.js"

timeout /t 3 /nobreak >nul

echo Opening demo instances...
echo.
echo 📖 Instructions:
echo 1. Wait for both browser windows to load completely
echo 2. In both windows, search for "Inception" 
echo 3. Click "🚀 Download via P2P" in the FIRST window
echo 4. Wait for chunks to start downloading (10-15 seconds)
echo 5. Click "🚀 Download via P2P" in the SECOND window  
echo 6. Watch REAL P2P chunk sharing happen! 🚀
echo.
echo 🔥 What to watch for:
echo - "Found X peers for Inception" (peer discovery)
echo - "Data channel with [peer] opened" (P2P connection)
echo - "Received chunk X from peer [id]" (actual P2P transfer!)
echo - Green squares filling up differently in each window
echo.

REM Open multiple browser instances for P2P testing
start "" "file:///%~dp0frontend/index.html"
timeout /t 2 /nobreak >nul
start "" "file:///%~dp0frontend/index.html"
timeout /t 2 /nobreak >nul
start "" "file:///%~dp0frontend/index.html"

echo.
echo ✅ Demo started! Check the browser windows and server console.
echo 💡 Pro tip: Open browser dev tools (F12) to see detailed logs
echo ⚡ Press any key to stop the demo...
pause >nul

echo.
echo 🛑 Stopping demo...
echo ✅ Demo stopped.
pause
