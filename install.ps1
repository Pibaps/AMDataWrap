<#
.SYNOPSIS
    Script d'installation des dependances Backend (Python venv) et Frontend (npm) pour AMDataWrap.
.DESCRIPTION
    Configure l'environnement virtuel Python dans backend\.venv, installe backend\requirements.txt,
    et installe les dependances npm pour le frontend principal (V4.1) ou les versions choisies.
.PARAMETER AllFrontends
    Installe les dependances npm pour tous les frontends (V1, V2, V3, V4.0, V4.1).
.PARAMETER Frontends
    Liste de frontends a installer (ex: -Frontends 4.1 ou -Frontends 3,4.1).
#>
param(
    [switch]$AllFrontends,
    [string[]]$Frontends
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " AMDataWrap - Installation des dependances" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Detection de Python (evite le raccourci vide du Microsoft Store)
Write-Host "[1/3] Verification de Python..." -ForegroundColor Yellow
$pythonExe = $null
$pythonArgs = @()

$candidates = @(
    @{ Exe = "py";      Args = @("-3") },
    @{ Exe = "python";  Args = @() },
    @{ Exe = "python3"; Args = @() }
)

foreach ($cand in $candidates) {
    $cmdInfo = Get-Command $cand.Exe -ErrorAction SilentlyContinue
    if ($null -eq $cmdInfo) { continue }
    $verOutput = & $cand.Exe @($cand.Args) --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $verOutput -match "Python\s+\d+") {
        $pythonExe = $cand.Exe
        $pythonArgs = $cand.Args
        Write-Host "Python detecte : $verOutput ($($cand.Exe) $($cand.Args -join ' '))" -ForegroundColor Green
        break
    }
}

if (-not $pythonExe) {
    Write-Host "ERREUR : Python 3.10+ est introuvable dans le PATH." -ForegroundColor Red
    Write-Host "Installez Python depuis https://www.python.org/downloads/ (cochez 'Add Python to PATH')." -ForegroundColor Yellow
    exit 1
}

# 2. Configuration du venv Backend et installation des requirements
Write-Host ""
Write-Host "[2/3] Configuration du Backend (Python venv)..." -ForegroundColor Yellow
$backendDir = Join-Path $root "backend"
$venvDir = Join-Path $backendDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    if (Test-Path $venvDir) {
        Write-Host "Venv incomplet detecte, recreation dans $venvDir..." -ForegroundColor DarkYellow
        Remove-Item -Recurse -Force $venvDir
    } else {
        Write-Host "Creation du venv Python dans $venvDir..." -ForegroundColor Gray
    }
    & $pythonExe @pythonArgs -m venv $venvDir
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $venvPython)) {
        Write-Host "ERREUR lors de la creation du venv Python." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Venv existant detecte dans $venvDir." -ForegroundColor Gray
}

$reqFile = Join-Path $backendDir "requirements.txt"
if (-not (Test-Path $reqFile)) {
    Write-Host "ERREUR : Fichier $reqFile introuvable." -ForegroundColor Red
    exit 1
}

Write-Host "Mise a jour de pip et installation des dependances Python..." -ForegroundColor Gray
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    Write-Host "AVERTISSEMENT : Echec de la mise a jour de pip, tentative d'installation directe..." -ForegroundColor DarkYellow
}
& $venvPython -m pip install -r $reqFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERREUR lors de l'installation des dependances Python." -ForegroundColor Red
    exit 1
}
Write-Host "Dependances Backend installees avec succes !" -ForegroundColor Green

# 3. Verification de Node.js / npm et installation Frontend
Write-Host ""
Write-Host "[3/3] Installation des dependances Frontend (Node / npm)..." -ForegroundColor Yellow
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERREUR : npm / Node.js est introuvable dans le PATH." -ForegroundColor Red
    Write-Host "Installez Node.js LTS (>= 18) depuis https://nodejs.org/." -ForegroundColor Yellow
    exit 1
}

$nodeVersion = & node --version 2>$null
$npmVersion = & npm --version 2>$null
Write-Host "Node.js detecte : $nodeVersion (npm $npmVersion)" -ForegroundColor Green

$frontendConfigs = @(
    @{ Id = "4.1"; Aliases = @("4.1", "v4.1");             Dir = "frontend-v4.1"; Name = "V4.1 Salon 3D (Principal)"; Default = $true },
    @{ Id = "4.0"; Aliases = @("4", "4.0", "v4", "v4.0");  Dir = "frontend-v4";   Name = "V4.0 Vinyl Studio";         Default = $false },
    @{ Id = "3";   Aliases = @("3", "v3");                 Dir = "frontend-v3";   Name = "V3 Continuum";              Default = $false },
    @{ Id = "2";   Aliases = @("2", "v2");                 Dir = "frontend-v2";   Name = "V2 Spatial 3D";             Default = $false },
    @{ Id = "1";   Aliases = @("1", "v1");                 Dir = "frontend";      Name = "V1 Classique";              Default = $false }
)

$targetFrontends = @()
if ($AllFrontends) {
    $targetFrontends = $frontendConfigs
} elseif ($Frontends -and $Frontends.Count -gt 0) {
    $parsed = $Frontends |
        ForEach-Object { $_ -split ',' } |
        ForEach-Object { $_.Trim().ToLower() } |
        Where-Object { $_ }
    $targetFrontends = @($frontendConfigs | Where-Object {
        $aliases = $_.Aliases
        $null -ne ($parsed | Where-Object { $aliases -contains $_ } | Select-Object -First 1)
    })
    if ($targetFrontends.Count -eq 0) {
        Write-Host "ERREUR : Aucune version reconnue pour: $($parsed -join ', '). Valeurs valides: 1, 2, 3, 4.0, 4.1" -ForegroundColor Red
        exit 1
    }
} else {
    $targetFrontends = @($frontendConfigs | Where-Object { $_.Default })
}

$hasError = $false
foreach ($fe in $targetFrontends) {
    $fePath = Join-Path $root $fe.Dir
    if (-not (Test-Path $fePath)) {
        Write-Host "Dossier $($fe.Dir) introuvable, ignore." -ForegroundColor DarkGray
        continue
    }
    Write-Host ""
    Write-Host "Installation npm pour $($fe.Name) ($($fe.Dir))..." -ForegroundColor Cyan
    Push-Location $fePath
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERREUR : npm install a echoue dans $($fe.Dir)" -ForegroundColor Red
            $hasError = $true
        } else {
            Write-Host "Dependances pour $($fe.Name) installees avec succes !" -ForegroundColor Green
        }
    } finally {
        Pop-Location
    }
}

if ($hasError) {
    Write-Host ""
    Write-Host "Installation terminee avec des erreurs." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host " Installation terminee avec succes !" -ForegroundColor Green
Write-Host " Lancez l'application avec :" -ForegroundColor Green
Write-Host "   .\start.ps1 -Versions 4.1   (ou start.bat)" -ForegroundColor White
Write-Host "==============================================" -ForegroundColor Green
