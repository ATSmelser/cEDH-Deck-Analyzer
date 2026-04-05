@echo off
cd /d "C:\Users\andre\OneDrive\Documents\cEDH Desk Analyzer"
start "cEDH Deck Analyzer" cmd /k npm start
timeout /t 2 >nul
start "" "chrome" "http://localhost:3000"
