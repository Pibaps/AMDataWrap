<#
.SYNOPSIS
    Script d'installation automatique des dépendances Backend (Python venv) et Frontend (npm) pour AMDataWrap.
.DESCRIPTION
    Configure l'environnement Python virtuel, installe requirements.txt,
    et installe les modules npm pour le frontend principal (v4.1) ainsi que les autres frontends si demandé.
.PARAMETER AllFrontends
    Si spécifié, installe les dépendances npm pour tous les frontends (v1, v2, v3, v4, v4.1).
    Par défaut, installe le frontend principal (frontend-v4.1) et vérifie les autres.
.PARAMETER Frontends
    Liste de frontends spécifiques à installer (ex: -Frontends "4.1" ou -Frontends "1,4.1").
#>
param(
    [switch]$AllFrontends,
    [string[]]$Frontends
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " AMDataWrap - Installation des dépendances" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Vérification de Python
Write-Host "[1/3] Vérification de Python..." -ForegroundColor Yellow
$pythonCmd = $null
if (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonCmd = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $pythonCmd = "py -3"
} elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
    $pythonCmd = "python3"
}

if (-not $pythonCmd) {
    Write-Host "ERREUR : Python est introuvable dans le PATH. Veuillez installer Python 3.10+ (avec pip) et relancer." -ForegroundColor Red
    exit 1
}

$pyVersion = & (Invoke-Expression $pythonCmd) --version 2>&1
Write-Host "Python détecté : $pyVersion ($pythonCmd)" -ForegroundColor Green

# 2. Setup Venv Backend & installation requirements
Write-Host ""
Write-Host "[2/3] Configuration du Backend (Python venv)..." -ForegroundColor Yellow
$backendDir = Join-Path $root "backend"
$venvDir = Join-Path $backendDir ".venv"

if (-not (Test-Path $venvDir)) {
    Write-Host "Création du venv Python dans $venvDir..." -ForegroundColor Gray
    & (Invoke-Expression $pythonCmd) -m venv $venvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERREUR lors de la création du venv." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Venv existant détecté dans $venvDir." -ForegroundColor Gray
}

$venvPip = Join-Path $venvDir "Scripts\pip.exe"
if (-not (Test-Path $venvPip)) {
    # Alternative Unix-style si script exécuté sous un environnement hybride
    $venvPip = Join-Path $venvDir "bin\pip"
}

$reqFile = Join-Path $backendDir "requirements.txt"
if (Test-Path $reqFile) {
    Write-Host "Installation des dépendances Python depuis $reqFile..." -ForegroundColor Gray
    & $venvPip install --upgrade pip
    & $venvPip install -r $reqFile
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERREUR lors de l'installation des dépendances Python." -ForegroundColor Red
        exit 1
    }
    Write-Host "Dépendances Backend installées avec succès !" -ForegroundColor Green
} else {
    Write-Host "Fichier $reqFile introuvable !" -ForegroundColor Red
}

# 3. Vérification de Node.js & npm
Write-Host ""
Write-Host "[3/3] Installation des dépendances Frontend (Node / npm)..." -ForegroundColor Yellow
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERREUR : npm / Node.js est introuvable dans le PATH. Veuillez installer Node.js (>= 18) et relancer." -ForegroundColor Red
    exit 1
}

$nodeVersion = & node --version 2>&1
$npmVersion = & npm --version 2>&1
Write-Host "Node.js détecté : $nodeVersion (npm: $npmVersion)" -ForegroundColor Green

$frontendConfigs = @(
    @{ Id = "4.1"; Dir = "frontend-v4.1"; Name = "V4.1 Salon 3D (Principal)"; Default = $true },
    @{ Id = "4.0"; Dir = "frontend-v4";   Name = "V4.0 Vinyl Studio";         Default = $false },
    @{ Id = "3";   Dir = "frontend-v3";   Name = "V3 Continuum";              Default = $false },
    @{ Id = "2";   Dir = "frontend-v2";   Name = "V2 Spatial 3D";             Default = $false },
    @{ Id = "1";   Dir = "frontend";      Name = "V1 Classique";              Default = $false }
)

$targetFrontends = @()
if ($AllFrontends) {
    $targetFrontends = $frontendConfigs
} elseif ($Frontends) {
    $parsed = $Frontends | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() }
    $targetFrontends = $frontendConfigs | Where-Object {
        $aliases = @($_.Id, "v" + $_.Id)
        $id = $_.Id
        $null -ne ($parsed | Where-Object { $aliases -contains $_ -or $_ -eq $id })
    }
} else {
    # Par défaut: installer le frontend principal v4.1
    $targetFrontends = $frontendConfigs | Where-Object { $_.Default }
}

foreach ($fe in $targetFrontends) {
    $fePath = Join-Path $root $fe.Dir
    if (Test-Path $fePath) {
        Write-Host ""
        Write-Host "Installation npm pour $($fe.Name) ($($fe.Dir))..." -ForegroundColor Cyan
        Push-Location $fePath
        try {
            if (Test-Path "package-lock.json") {
                npm install
            } else {
                npm install
            }
            if ($LASTEXITCODE -ne 0) {
                Write-Host "AVERTISSEMENT : Erreur pendant npm install dans $($fe.Dir)" -ForegroundColor DarkYellow
            } else {
                Write-Host "Dépendances pour $($fe.Name) installées avec succès !" -ForegroundColor Green
            }
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "Dossier $($fe.Dir) non trouvé, ignoré." -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host " Installation terminée avec succès ! " -ForegroundColor Green
Write-Host " Vous pouvez lancer l'application avec :" -ForegroundColor Green
Write-Host "   .\start.ps1        (ou start.bat)" -ForegroundColor White
Write-Host "   .\start.ps1 -Versions 4.1" -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Green
