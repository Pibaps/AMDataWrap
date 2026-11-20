# AMDataWrap launcher — Backend (:8000 LAN) + V1 (:5173) + V2 (:5174) + V3 (:5175) + V4 (:5176)
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-PortListening($port) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $c)
}

if (Test-PortListening 8000) {
    Write-Host "Backend API deja actif sur http://0.0.0.0:8000" -ForegroundColor Yellow
} else {
    Write-Host "Demarrage du Backend FastAPI (:8000 LAN)..." -ForegroundColor Cyan
    Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", ".\backend\.venv\Scripts\uvicorn.exe backend.app.main:app --host 0.0.0.0 --port 8000"
}

if (Test-PortListening 5173) {
    Write-Host "V1 Classique deja actif sur http://localhost:5173" -ForegroundColor Yellow
} else {
    Write-Host "Demarrage de V1 Classique (:5173)..." -ForegroundColor Green
    Start-Process powershell -WorkingDirectory "$root\frontend" -ArgumentList "-NoExit", "-Command", "npm run dev"
}

if (Test-PortListening 5174) {
    Write-Host "V2 Spatial 3D deja actif sur http://localhost:5174" -ForegroundColor Yellow
} else {
    Write-Host "Demarrage de V2 Spatial 3D (:5174)..." -ForegroundColor Magenta
    Start-Process powershell -WorkingDirectory "$root\frontend-v2" -ArgumentList "-NoExit", "-Command", "npm run dev"
}

if (Test-PortListening 5175) {
    Write-Host "V3 Continuum deja actif sur http://localhost:5175" -ForegroundColor Yellow
} else {
    Write-Host "Demarrage de V3 Continuum (:5175)..." -ForegroundColor Blue
    Start-Process powershell -WorkingDirectory "$root\frontend-v3" -ArgumentList "-NoExit", "-Command", "npm run dev"
}

if (Test-PortListening 5176) {
    Write-Host "V4 Vinyl Studio 3D deja actif sur http://localhost:5176" -ForegroundColor Yellow
} else {
    Write-Host "Demarrage de V4 Vinyl Studio 3D (:5176 LAN)..." -ForegroundColor Red
    Start-Process powershell -WorkingDirectory "$root\frontend-v4" -ArgumentList "-NoExit", "-Command", "npm run dev"
}

Start-Sleep -Seconds 2
Start-Process "http://localhost:5176"
Write-Host "V1 Classique       : http://localhost:5173" -ForegroundColor Green
Write-Host "V2 Spatial 3D      : http://localhost:5174" -ForegroundColor Magenta
Write-Host "V3 Continuum       : http://localhost:5175" -ForegroundColor Cyan
Write-Host "V4 Vinyl Studio 3D : http://localhost:5176" -ForegroundColor Red
