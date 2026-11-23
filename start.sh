#!/usr/bin/env bash
# AMDataWrap launcher pour Linux / macOS
# Backend (:8000 LAN) + interfaces (V1 :5173, V2 :5174, V3 :5175, V4.0 :5176, V4.1 :5177)
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
    echo "  --versions=1,2,3,4.0,4.1  Lancer des versions specifiques du frontend"
    echo "  --all                     Lancer toutes les versions frontends (V1 a V4.1)"
    echo "  --no-browser              Ne pas ouvrir le navigateur automatiquement"
    echo "  -h, --help                Afficher cette aide"
    echo ""
    echo "Exemples:"
    echo "  $0                        # Backend + toutes les versions installees"
    echo "  $0 --versions=4.1         # Backend + V4.1 (Principal)"
    echo "  $0 --versions=3,4.1       # Backend + V3 et V4.1"
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h)
            usage
            ;;
        --no-browser)
            NO_BROWSER=true
            shift
            ;;
        --all)
            ALL_VERSIONS=true
            shift
            ;;
        --versions=*|-versions=*)
            IFS=',' read -ra REQUESTED_VERSIONS <<< "${1#*=}"
            shift
            ;;
        --versions|-versions)
            if [ $# -lt 2 ]; then
                echo "ERREUR : --versions attend une valeur (ex: --versions 4.1)" >&2
                exit 1
            fi
            IFS=',' read -ra REQUESTED_VERSIONS <<< "$2"
            shift 2
            ;;
        *)
            echo "ERREUR : Option inconnue: $1" >&2
            echo "Utilisez --help pour voir les options disponibles." >&2
            exit 1
            ;;
    esac
done

# Verification uvicorn backend
PYTHON_UVICORN=""
if [ -x "$VENV_DIR/bin/uvicorn" ]; then
    PYTHON_UVICORN="$VENV_DIR/bin/uvicorn"
elif command -v uvicorn >/dev/null 2>&1; then
    PYTHON_UVICORN="uvicorn"
else
    echo "ERREUR : uvicorn introuvable dans $VENV_DIR/bin/uvicorn ou PATH." >&2
    echo "Executez d'abord : ./install.sh" >&2
    exit 1
fi

test_port() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -tuln | grep -qE "[:.]${port}([[:space:]]|$)"
    elif command -v lsof >/dev/null 2>&1; then
        lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1
    elif command -v nc >/dev/null 2>&1; then
        nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    else
        (exec 3<>/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
    fi
}

PIDS=()
cleanup() {
    local pid
    echo ""
    echo "Arret des processus AMDataWrap..."
    for pid in "${PIDS[@]+"${PIDS[@]}"}"; do
        if command -v pkill >/dev/null 2>&1; then
            pkill -TERM -P "$pid" >/dev/null 2>&1 || true
        fi
        if kill -0 "$pid" >/dev/null 2>&1; then
            kill "$pid" >/dev/null 2>&1 || true
        fi
    done
    wait >/dev/null 2>&1 || true
    echo "Tous les services sont arretes."
}
trap cleanup SIGINT SIGTERM EXIT

# Configuration des frontends (id:dir:port:name:is_principal)
FRONTENDS=(
    "4.1:frontend-v4.1:5177:V4.1 Salon 3D:true"
    "4.0:frontend-v4:5176:V4.0 Vinyl Studio:false"
    "3:frontend-v3:5175:V3 Continuum:false"
    "2:frontend-v2:5174:V2 Spatial 3D:false"
    "1:frontend:5173:V1 Classique:false"
)

should_run() {
    local id="$1"
    local req clean_req
    if [ "$ALL_VERSIONS" = true ] || [ ${#REQUESTED_VERSIONS[@]} -eq 0 ]; then
        return 0
    fi
    for req in "${REQUESTED_VERSIONS[@]}"; do
        clean_req=$(echo "$req" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
        if [ "$clean_req" = "$id" ] || [ "$clean_req" = "v$id" ]; then
            return 0
        fi
        if [ "$id" = "4.0" ] && { [ "$clean_req" = "4" ] || [ "$clean_req" = "v4" ]; }; then
            return 0
        fi
    done
    return 1
}

# Verification qu'au moins un frontend correspond si --versions est passe
SELECTED_COUNT=0
for item in "${FRONTENDS[@]}"; do
    IFS=":" read -r fid fdir fport fname fprincipal <<< "$item"
    if should_run "$fid"; then
        SELECTED_COUNT=$((SELECTED_COUNT + 1))
    fi
done

if [ "$SELECTED_COUNT" -eq 0 ]; then
    echo "ERREUR : Aucune version reconnue pour: ${REQUESTED_VERSIONS[*]}. Valeurs valides: 1, 2, 3, 4.0, 4.1" >&2
    exit 1
fi

# Demarrage Backend
if test_port 8000; then
    echo "Backend API deja actif sur http://0.0.0.0:8000"
else
    echo "Demarrage du Backend FastAPI (:8000 LAN)..."
    (
        cd "$ROOT_DIR"
        exec "$PYTHON_UVICORN" backend.app.main:app --host 0.0.0.0 --port 8000
    ) &
    PIDS+=($!)
fi

OPEN_URL=""
STARTED_FRONTENDS=()

for item in "${FRONTENDS[@]}"; do
    IFS=":" read -r fid fdir fport fname fprincipal <<< "$item"
    if should_run "$fid"; then
        target_dir="$ROOT_DIR/$fdir"
        if [ ! -d "$target_dir" ]; then
            echo "Dossier introuvable : $target_dir"
            continue
        fi
        if [ ! -d "$target_dir/node_modules" ]; then
            echo "AVERTISSEMENT : $fdir/node_modules absent (lancez ./install.sh --frontends=$fid). Ignore."
            continue
        fi

        if [ -z "$OPEN_URL" ] || [ "$fprincipal" = "true" ]; then
            OPEN_URL="http://localhost:$fport"
        fi

        if test_port "$fport"; then
            echo "$fname deja actif sur http://localhost:$fport"
        else
            echo "Demarrage de $fname (:$fport)..."
            npm --prefix "$target_dir" run dev &
            PIDS+=($!)
        fi
        STARTED_FRONTENDS+=("$fname:$fport:$fprincipal")
    fi
done

# Ouverture navigateur
if [ "$NO_BROWSER" = false ] && [ -n "$OPEN_URL" ]; then
    (
        sleep 2
        if command -v xdg-open >/dev/null 2>&1; then
            xdg-open "$OPEN_URL" >/dev/null 2>&1 || true
        elif command -v open >/dev/null 2>&1; then
            open "$OPEN_URL" >/dev/null 2>&1 || true
        fi
    ) &
fi

echo ""
echo "Backend API        : http://127.0.0.1:8000"
for item in "${STARTED_FRONTENDS[@]+"${STARTED_FRONTENDS[@]}"}"; do
    IFS=":" read -r fname fport fprincipal <<< "$item"
    suffix=""
    [ "$fprincipal" = "true" ] && suffix="  (Principal)"
    printf "%-19s: http://localhost:%s%s\n" "$fname" "$fport" "$suffix"
done
echo ""
echo "Appuyez sur Ctrl+C pour arreter tous les services."

wait
