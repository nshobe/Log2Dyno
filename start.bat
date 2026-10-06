@echo off
title Log2Dyno - Virtual Dyno
echo Starting Log2Dyno Server...
start "" "http://localhost:3300"
node server/index.js
pause
