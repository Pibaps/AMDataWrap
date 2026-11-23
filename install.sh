#!/usr/bin/env bash
# Script d'installation des dependances Backend (Python venv) et Frontend (npm) pour Linux/macOS
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ALL_FRONTENDS=false
FRONTEND_ARGS=()

usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --all                    Installer tous les frontends (V1 a V4.1)"
    echo "  --frontends=1,2,3,4,4.1  Installer des versions specifiques (defaut: 4.1)"
    echo "  -h, --help               Afficher cette aide"
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)
            usage
            ;;
        --all|-all|-a)
            ALL_FRONTENDS=true
            shift
            ;;
        --frontends=*|-frontends=*)
            IFS=',' read -ra FRONTEND_ARGS <<< "${1#*=}"
            shift
            ;;
        --frontends|-frontends)
            if [ $# -lt 2 ]; then
                echo "ERREUR : --frontends attend une valeur (ex: --frontends 4.1)" >&2
                exit 1
            fi
            IFS=',' read -ra FRONTEND_ARGS <<< "$2"
            shift 2
            ;;
        *)
            echo "ERREUR : Option inconnue: $1" >&2
            echo "Utilisez --help pour voir les options disponibles." >&2
            exit 1
            ;;
    esac
done

echo "=============================================="
echo " AMDataWrap - Installation (Linux/macOS)"
echo "=============================================="
echo ""

# 1. Verification de Python 3
echo "[1/3] Verification de Python..."
PYTHON_BIN=""
for cmd in python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
        if "$cmd" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >/dev/null 2>&1; then
            PYTHON_BIN="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON_BIN" ]; then
    echo "ERREUR : Python 3.10+ est introuvable." >&2
    echo "Installez python3 et python3-venv (ex: sudo apt install python3 python3-venv)." >&2
    exit 1
fi

echo "Python detecte : $("$PYTHON_BIN" --version) ($PYTHON_BIN)"

# 2. Configuration du venv Backend
echo ""
echo "[2/3] Configuration du Backend (Python venv)..."
BACKEND_DIR="$ROOT_DIR/backend"
VENV_DIR="$BACKEND_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"

if [ ! -x "$VENV_PYTHON" ] || ! "$VENV_PYTHON" -m pip --version >/dev/null 2>&1; then
    if [ -d "$VENV_DIR" ]; then
        echo "Venv incomplet detecte, recreation dans $VENV_DIR..."
        rm -rf "$VENV_DIR"
    else
        echo "Creation du venv Python dans $VENV_DIR..."
    fi
    if ! "$PYTHON_BIN" -m venv "$VENV_DIR"; then
        rm -rf "$VENV_DIR"
        echo "ERREUR : Echec de creation du venv. Verifiez que python3-venv est installe (ex: sudo apt install python3-venv)." >&2
        exit 1
    fi
else
    echo "Venv existant detecte dans $VENV_DIR."
fi

REQ_FILE="$BACKEND_DIR/requirements.txt"
if [ ! -f "$REQ_FILE" ]; then
    echo "ERREUR : Fichier $REQ_FILE introuvable." >&2
    exit 1
fi

echo "Installation des dependances Python..."
"$VENV_PYTHON" -m pip install --upgrade pip || true
"$VENV_PYTHON" -m pip install -r "$REQ_FILE"
echo "Dependances Backend installees avec succes !"

# 3. Verification de Node.js & npm
echo ""
echo "[3/3] Installation des dependances Frontend (Node / npm)..."
if ! command -v npm >/dev/null 2>&1; then
    echo "ERREUR : npm / Node.js est introuvable. Installez Node.js (>= 18) et npm." >&2
    exit 1
fi

echo "Node.js detecte : $(node --version) (npm $(npm --version))"

matches_frontend() {
    local target="$1"
    local req clean_req
    for req in "${FRONTEND_ARGS[@]}"; do
        clean_req=$(echo "$req" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
        if [ "$clean_req" = "$target" ] || [ "$clean_req" = "v$target" ]; then
            return 0
        fi
        if [ "$target" = "4.0" ] && { [ "$clean_req" = "4" ] || [ "$clean_req" = "v4" ]; }; then
            return 0
        fi
    done
    return 1
}

should_install() {
    local target="$1"
    if [ "$ALL_FRONTENDS" = true ]; then
        return 0
    fi
    if [ ${#FRONTEND_ARGS[@]} -eq 0 ]; then
        [ "$target" = "4.1" ]
        return $?
    fi
    matches_frontend "$target"
}

FRONTENDS=(
    "4.1:frontend-v4.1:V4.1 Salon 3D (Principal)"
    "4.0:frontend-v4:V4.0 Vinyl Studio"
    "3:frontend-v3:V3 Continuum"
    "2:frontend-v2:V2 Spatial 3D"
    "1:frontend:V1 Classique"
)

INSTALLED_COUNT=0
for item in "${FRONTENDS[@]}"; do
    IFS=":" read -r fid fdir fname <<< "$item"
    if should_install "$fid"; then
        if [ -d "$ROOT_DIR/$fdir" ]; then
            echo ""
            echo "Installation npm pour $fname ($fdir)..."
            (
                cd "$ROOT_DIR/$fdir"
                npm install
            )
            echo "Dependances pour $fname installees avec succes !"
            INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
        else
            echo "Dossier $fdir introuvable, ignore."
        fi
    fi
done

if [ "$INSTALLED_COUNT" -eq 0 ]; then
    echo "ERREUR : Aucune version valide trouvee pour: ${FRONTEND_ARGS[*]}" >&2
    echo "Valeurs valides : 1, 2, 3, 4.0, 4.1" >&2
    exit 1
fi

echo ""
echo "=============================================="
echo " Installation terminee avec succes !"
echo " Lancez l'application avec :"
echo "   ./start.sh --versions=4.1"
echo "=============================================="
