# AMDataWrap launcher (PowerShell)
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-PortListening($port) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $c)
}

if (Test-PortListening 8000) {
    Write-Host "Backend API deja actif sur http://127.0.0.1:8000" -ForegroundColor Yellow
} else {
    Write-Host "Demarrage du Backend FastAPI..." -ForegroundColor Cyan
    Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", ".\backend\.venv\Scripts\uvicorn.exe backend.app.main:app --host 127.0.0.1 --port 8000"
}

if (Test-PortListening 5173) {
    Write-Host "Frontend Vite deja actif sur http://localhost:5173" -ForegroundColor Yellow
} else {
    Write-Host "Demarrage du Frontend Vite..." -ForegroundColor Cyan
    Start-Process powershell -WorkingDirectory "$root\frontend" -ArgumentList "-NoExit", "-Command", "npm run dev"
}

Start-Sleep -Seconds 2
Start-Process "http://localhost:5173"
Write-Host "AMDataWrap pret : http://localhost:5173" -ForegroundColor Green
