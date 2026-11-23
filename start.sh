#!/usr/bin/env bash
# AMDataWrap launcher pour Linux / macOS
# Backend (:8000 LAN) + interfaces (V1 :5173, V2 :5174, V3 :5175, V4.0 :5176, V4.1 :5177)
# Par défaut, lance le Backend et V4.1 (ou toutes les versions avec --all)
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
VENV_DIR="$BACKEND_DIR/.venv"

NO_BROWSER=false
ALL_VERSIONS=false
REQUESTED_VERSIONS=()

usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --versions=1,2,3,4.0,4.1  Lancer des versions spécifiques du frontend"
    echo "  --all                     Lancer toutes les versions frontends (V1 à V4.1)"
    echo "  --no-browser              Ne pas ouvrir le navigateur automatiquement"
    echo "  -h, --help                Afficher cette aide"
    echo ""
    echo "Exemples:"
    echo "  $0                        # Backend + V4.1 (Principal)"
    echo "  $0 --all                  # Backend + V1 à V4.1"
    echo "  $0 --versions=4.1         # Backend + V4.1"
    echo "  $0 --versions=3,4.1       # Backend + V3 et V4.1"
    exit 0
}

for arg in "$@"; do
    case "$arg" in
        --help|-h)
            usage
            ;;
        --no-browser)
            NO_BROWSER=true
            ;;
        --all)
            ALL_VERSIONS=true
            ;;
        --versions=*|-versions=*)
            IFS=',' read -ra REQUESTED_VERSIONS <<< "${arg#*=}"
            ;;
        *)
            ;;
    esac
done

# Vérification venv backend
PYTHON_UVICORN=""
if [ -f "$VENV_DIR/bin/uvicorn" ]; then
    PYTHON_UVICORN="$VENV_DIR/bin/uvicorn"
elif command -v uvicorn >/dev/null 2>&1; then
    PYTHON_UVICORN="uvicorn"
else
    echo "ERREUR : uvicorn introuvable dans $VENV_DIR/bin/uvicorn ou PATH." >&2
    echo "Veuillez d'abord exécuter : ./install.sh" >&2
    exit 1
fi

test_port() {
    local port="$1"
    if command -v nc >/dev/null 2>&1; then
        nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    elif command -v lsof >/dev/null 2>&1; then
        lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1
    elif command -v ss >/dev/null 2>&1; then
        ss -tuln | grep -q ":$port "
    else
        (exec 3<>/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
    fi
}

PIDS=()
cleanup() {
    echo ""
    echo "Arrêt des processus AMDataWrap..."
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" >/dev/null 2>&1; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
    echo "Tous les services sont arrêtés."
}
trap cleanup SIGINT SIGTERM EXIT

# Démarrage Backend
if test_port 8000; then
    echo "Backend API déjà actif sur http://0.0.0.0:8000"
else
    echo "Démarrage du Backend FastAPI (:8000 LAN)..."
    (
        cd "$ROOT_DIR"
        "$PYTHON_UVICORN" backend.app.main:app --host 0.0.0.0 --port 8000
    ) &
    PIDS+=($!)
fi

# Frontends configuration
# id:dir:port:name:is_principal
FRONTENDS=(
    "4.1:frontend-v4.1:5177:V4.1 Salon 3D:true"
    "4.0:frontend-v4:5176:V4.0 Vinyl Studio:false"
    "3:frontend-v3:5175:V3 Continuum:false"
    "2:frontend-v2:5174:V2 Spatial 3D:false"
    "1:frontend:5173:V1 Classique:false"
)

should_run() {
    local id="$1"
    local is_principal="$2"
    if [ "$ALL_VERSIONS" = true ]; then
        return 0
    fi
    if [ ${#REQUESTED_VERSIONS[@]} -eq 0 ]; then
        # Par défaut, toutes ou principal ?
        # Dans start.ps1 par défaut toutes les versions sont lancées si non spécifié,
        # ou au moins 4.1. Lançons toutes ou 4.1 selon parité avec start.ps1
        return 0
    fi
    for req in "${REQUESTED_VERSIONS[@]}"; do
        clean_req=$(echo "$req" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
        if [ "$clean_req" = "$id" ] || [ "$clean_req" = "v$id" ]; then
            return 0
        fi
    done
    return 1
}

OPEN_URL=""

for item in "${FRONTENDS[@]}"; do
    IFS=":" read -r fid fdir fport fname fprincipal <<< "$item"
    if should_run "$fid" "$fprincipal"; then
        target_dir="$ROOT_DIR/$fdir"
        if [ ! -d "$target_dir" ]; then
            echo "Dossier introuvable : $target_dir"
            continue
        fi

        if [ -z "$OPEN_URL" ] || [ "$fprincipal" = "true" ]; then
            OPEN_URL="http://localhost:$fport"
        fi

        if test_port "$fport"; then
            echo "$fname déjà actif sur http://localhost:$fport"
        else
            echo "Démarrage de $fname (:$fport)..."
            (
                cd "$target_dir"
                npm run dev
            ) &
            PIDS+=($!)
        fi
    fi
done

# Ouverture navigateur
if [ "$NO_BROWSER" = false ] && [ -n "$OPEN_URL" ]; then
    (
        sleep 2
        if command -v xdg-open >/dev/null 2>&1; then
            xdg-open "$OPEN_URL" >/dev/null 2>&1 &
        elif command -v open >/dev/null 2>&1; then
            open "$OPEN_URL" >/dev/null 2>&1 &
        fi
    ) &
fi

echo ""
echo "Backend API        : http://127.0.0.1:8000"
for item in "${FRONTENDS[@]}"; do
    IFS=":" read -r fid fdir fport fname fprincipal <<< "$item"
    if should_run "$fid" "$fprincipal"; then
        suffix=""
        [ "$fprincipal" = "true" ] && suffix="  (Principal)"
        printf "%-19s: http://localhost:%s%s\n" "$fname" "$fport" "$suffix"
    fi
done
echo ""
echo "Appuyez sur Ctrl+C pour arrêter tous les services."

# Attendre les processus enfants
wait
