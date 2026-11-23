# AMDataWrap launcher — Backend (:8000 LAN) + toutes les interfaces (V1 :5173, V2 :5174, V3 :5175, V4.0 :5176, V4.1 :5177)
# Par defaut, toutes les versions sont lancees pour etre utilisables immediatement.
# Utilisez `.\start.ps1 -Versions 4.1` (ou `.\start.ps1 -Versions 3,4.1`) pour cibler certaines versions.
param(
    [string[]]$Versions,
    [switch]$Legacy,
    [switch]$NoBrowser
)

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-PortListening($port) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $c)
}

$frontends = @(
    @{ Id = "1";   Aliases = @("1", "v1");               Name = "V1 Classique";      Dir = "frontend";      Port = 5173; Color = "Green" },
    @{ Id = "2";   Aliases = @("2", "v2");               Name = "V2 Spatial 3D";     Dir = "frontend-v2";   Port = 5174; Color = "Magenta" },
    @{ Id = "3";   Aliases = @("3", "v3");               Name = "V3 Continuum";      Dir = "frontend-v3";   Port = 5175; Color = "Blue" },
    @{ Id = "4.0"; Aliases = @("4", "4.0", "v4", "v4.0"); Name = "V4.0 Vinyl Studio"; Dir = "frontend-v4";   Port = 5176; Color = "Red" },
    @{ Id = "4.1"; Aliases = @("4.1", "v4.1");           Name = "V4.1 Salon 3D";     Dir = "frontend-v4.1"; Port = 5177; Color = "DarkYellow"; Principal = $true }
)

$requested = @()
if ($Versions) {
    $requested = $Versions |
        ForEach-Object { $_ -split ',' } |
        ForEach-Object { $_.Trim().ToLower() } |
        Where-Object { $_ }
}

if ($requested.Count -gt 0) {
    $selected = $frontends | Where-Object {
        $aliases = $_.Aliases
        $null -ne ($requested | Where-Object { $aliases -contains $_ } | Select-Object -First 1)
    }
    if (-not $selected -or $selected.Count -eq 0) {
        Write-Host "Aucune version reconnue pour: $($requested -join ', '). Valeurs valides: 1, 2, 3, 4.0, 4.1" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "   AMDataWrap - Menu de demarrage" -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "  [1] V4.1 Salon 3D      (:5177) [Defaut]" -ForegroundColor DarkYellow
    Write-Host "  [2] V4.0 Vinyl Studio  (:5176)" -ForegroundColor Red
    Write-Host "  [3] V3 Continuum       (:5175)" -ForegroundColor Blue
    Write-Host "  [4] V2 Spatial 3D      (:5174)" -ForegroundColor Magenta
    Write-Host "  [5] V1 Classique       (:5173)" -ForegroundColor Green
    Write-Host "  [A] Toutes les interfaces" -ForegroundColor White
    Write-Host "  [B] Backend seul       (:8000)" -ForegroundColor Cyan
    Write-Host "  [Q] Quitter" -ForegroundColor DarkGray
    Write-Host "-----------------------------------------" -ForegroundColor DarkGray
    $choice = Read-Host "Votre choix (ex: 1, 2,3 ou Entree = V4.1)"
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }

    $tokens = $choice -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }
    if ($tokens -contains "q") {
        Write-Host "Annule." -ForegroundColor DarkGray
        exit 0
    } elseif ($tokens -contains "b") {
        $selected = @()
    } elseif ($tokens -contains "a") {
        $selected = $frontends
    } else {
        $menuMap = @{ "1" = "4.1"; "2" = "4.0"; "3" = "3"; "4" = "2"; "5" = "1" }
        $mapped = $tokens | ForEach-Object { if ($menuMap.ContainsKey($_)) { $menuMap[$_] } else { $_ } }
        $selected = $frontends | Where-Object {
            $aliases = $_.Aliases
            $null -ne ($mapped | Where-Object { $aliases -contains $_ } | Select-Object -First 1)
        }
        if (-not $selected -or $selected.Count -eq 0) {
            Write-Host "Choix invalide: $choice" -ForegroundColor Red
            exit 1
        }
    }
}

if (Test-PortListening 8000) {
    Write-Host "Backend API deja actif sur http://0.0.0.0:8000" -ForegroundColor Yellow
} else {
    Write-Host "Demarrage du Backend FastAPI (:8000 LAN)..." -ForegroundColor Cyan
    $venvUvicorn = Join-Path $root "backend\.venv\Scripts\uvicorn.exe"
    if (Test-Path $venvUvicorn) {
        Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", ".\backend\.venv\Scripts\uvicorn.exe backend.app.main:app --host 0.0.0.0 --port 8000"
    } elseif (Get-Command uvicorn -ErrorAction SilentlyContinue) {
        Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", "uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"
    } else {
        Write-Host "ERREUR : uvicorn est introuvable. Executez d'abord .\install.ps1 (ou install.bat)." -ForegroundColor Red
        exit 1
    }
}

foreach ($fe in $selected) {
    $feDir = Join-Path $root $fe.Dir
    if (-not (Test-Path $feDir)) {
        Write-Host "Dossier introuvable pour $($fe.Name) : $feDir" -ForegroundColor Red
        continue
    }
    if (Test-PortListening $fe.Port) {
        Write-Host "$($fe.Name) deja actif sur http://localhost:$($fe.Port)" -ForegroundColor Yellow
    } else {
        Write-Host "Demarrage de $($fe.Name) (:$($fe.Port))..." -ForegroundColor $fe.Color
        $cmd = "if (-not (Test-Path node_modules)) { Write-Host 'Installation des dependances ($($fe.Dir))...' -ForegroundColor Cyan; npm install }; npm run dev"
        Start-Process powershell -WorkingDirectory $feDir -ArgumentList "-NoExit", "-Command", $cmd
    }
}

if (-not $NoBrowser -and $selected.Count -gt 0) {
    Start-Sleep -Seconds 2
    $defaultFe = $selected | Where-Object { $_.Principal } | Select-Object -First 1
    if (-not $defaultFe) {
        $defaultFe = $selected | Select-Object -First 1
    }
    Start-Process "http://localhost:$($defaultFe.Port)"
}

Write-Host ""
Write-Host "Backend API        : http://127.0.0.1:8000" -ForegroundColor Cyan
foreach ($fe in ($selected | Sort-Object Port -Descending)) {
    $suffix = if ($fe.Principal) { "  (Principal)" } else { "" }
    Write-Host ("{0,-19}: http://localhost:{1}{2}" -f $fe.Name, $fe.Port, $suffix) -ForegroundColor $fe.Color
}
