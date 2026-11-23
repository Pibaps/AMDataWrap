#!/usr/bin/env bash
# Script d'installation automatique des dépendances Backend (Python venv) et Frontend (npm) pour Linux/macOS
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================="
echo " AMDataWrap - Installation des dépendances (Linux/macOS)"
echo "========================================="
echo ""

# 1. Vérification Python
echo "[1/3] Vérification de Python..."
PYTHON_BIN=""
for cmd in python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
        PYTHON_BIN="$cmd"
        break
    fi
done

if [ -z "$PYTHON_BIN" ]; then
    echo "ERREUR : Python 3 est introuvable. Veuillez installer python3 et python3-venv (ex: sudo apt install python3 python3-venv)." >&2
    exit 1
fi

echo "Python détecté : $("$PYTHON_BIN" --version) ($PYTHON_BIN)"

# 2. Venv Backend
echo ""
echo "[2/3] Configuration du Backend (Python venv)..."
BACKEND_DIR="$ROOT_DIR/backend"
VENV_DIR="$BACKEND_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
    echo "Création du venv Python dans $VENV_DIR..."
    "$PYTHON_BIN" -m venv "$VENV_DIR"
else
    echo "Venv existant détecté dans $VENV_DIR."
fi

VENV_PIP="$VENV_DIR/bin/pip"
if [ ! -f "$VENV_PIP" ]; then
    echo "ERREUR : pip est introuvable dans $VENV_DIR/bin/pip" >&2
    exit 1
fi

REQ_FILE="$BACKEND_DIR/requirements.txt"
if [ -f "$REQ_FILE" ]; then
    echo "Installation des dépendances Python..."
    "$VENV_PIP" install --upgrade pip
    "$VENV_PIP" install -r "$REQ_FILE"
    echo "Dépendances Backend installées avec succès !"
fi

# 3. Vérification Node.js & npm
echo ""
echo "[3/3] Installation des dépendances Frontend (Node / npm)..."
if ! command -v npm >/dev/null 2>&1; then
    echo "ERREUR : npm est introuvable. Veuillez installer Node.js (>= 18) et npm." >&2
    exit 1
fi

echo "Node.js : $(node --version) (npm: $(npm --version))"

ALL_FRONTENDS=false
FRONTEND_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --all|-all|-a)
            ALL_FRONTENDS=true
            ;;
        --frontends=*|-frontends=*)
            IFS=',' read -ra FRONTEND_ARGS <<< "${arg#*=}"
            ;;
        *)
            ;;
    esac
done

should_install() {
    local target="$1"
    if [ "$ALL_FRONTENDS" = true ]; then
        return 0
    fi
    if [ ${#FRONTEND_ARGS[@]} -eq 0 ]; then
        # Par défaut, installe seulement 4.1
        [ "$target" = "4.1" ] && return 0 || return 1
    fi
    for req in "${FRONTEND_ARGS[@]}"; do
        clean_req=$(echo "$req" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
        if [ "$clean_req" = "$target" ] || [ "$clean_req" = "v$target" ]; then
            return 0
        fi
    done
    return 1
}

FRONTENDS=(
    "4.1:frontend-v4.1:V4.1 Salon 3D (Principal)"
    "4.0:frontend-v4:V4.0 Vinyl Studio"
    "3:frontend-v3:V3 Continuum"
    "2:frontend-v2:V2 Spatial 3D"
    "1:frontend:V1 Classique"
)

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
            echo "Dépendances pour $fname installées avec succès !"
        fi
    fi
done

echo ""
echo "========================================="
echo " Installation terminée avec succès !"
echo " Vous pouvez lancer l'application avec :"
echo "   ./start.sh"
echo "   ./start.sh --versions=4.1"
echo "========================================="
