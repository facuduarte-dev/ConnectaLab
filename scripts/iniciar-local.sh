#!/usr/bin/env bash
set -Eeuo pipefail

# Resuelve la raiz desde la ubicacion del propio script. De esta manera ParkEx
# puede estar clonado en cualquier carpeta y el comando funciona desde cualquier
# directorio.
DIRECTORIO_SCRIPT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROYECTO="$(cd -- "$DIRECTORIO_SCRIPT/.." && pwd -P)"

LOGS="${PARKEX_LOG_DIR:-$PROYECTO/logs}"
PUERTO_WEB="${PARKEX_WEB_PORT:-5173}"

API_ENV="$PROYECTO/api/.env"
GATEWAY_ENV="$PROYECTO/gateway/.env"
VISION_CONFIG="$PROYECTO/vision/config.json"
VISION_JAR="$PROYECTO/vision/target/matricula-ocr-1.0.0.jar"

declare -a PIDS=()
declare -A NOMBRES=()
DROIDCAM_PID=""

error() {
  echo >&2
  echo "ERROR: $*" >&2
  exit 1
}

valor_env() {
  local archivo="$1"
  local clave="$2"

  awk -F= -v clave="$clave" '
    $1 == clave {
      valor = substr($0, index($0, "=") + 1)
      sub(/\r$/, "", valor)
      print valor
      exit
    }
  ' "$archivo"
}

exigir_env() {
  local archivo="$1"
  local clave="$2"
  local valor
  valor="$(valor_env "$archivo" "$clave")"

  if [[ -z "$valor" ]] || [[ "$valor" =~ (xxxxxxxx|tu-project|pegar-aca|poner-aca) ]]; then
    error "Falta $clave en $archivo. Copia el archivo .example y completa el valor real."
  fi
}

puerto_ocupado() {
  local puerto="$1"
  [[ -n "$(ss -H -ltn "sport = :$puerto" 2>/dev/null)" ]]
}

iniciar_servicio() {
  local nombre="$1"
  local carpeta="$2"
  shift 2

  local log="$LOGS/$nombre.log"
  : > "$log"

  (
    cd "$carpeta"
    exec "$@"
  ) >>"$log" 2>&1 &

  local pid=$!
  PIDS+=("$pid")
  NOMBRES["$pid"]="$nombre"
  echo "[OK] $nombre iniciado (log: $log)"
}

detener_todo() {
  local codigo="${1:-0}"
  trap - INT TERM EXIT

  if ((${#PIDS[@]})); then
    kill "${PIDS[@]}" 2>/dev/null || true
    wait "${PIDS[@]}" 2>/dev/null || true
  fi

  # Solo se cierra DroidCam cuando lo inicio este script. Una instancia que ya
  # estaba abierta pertenece al usuario y se deja funcionando.
  if [[ -n "$DROIDCAM_PID" ]]; then
    kill "$DROIDCAM_PID" 2>/dev/null || true
  fi

  echo "Servicios de ParkEx detenidos."
  exit "$codigo"
}

activar_node() {
  local node_mayor=0

  if command -v node >/dev/null 2>&1; then
    node_mayor="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi

  if ((node_mayor >= 22)); then
    return
  fi

  # NVM es opcional. Se usa si esta disponible, sin asumir el nombre del
  # usuario ni una ruta absoluta de una computadora concreta.
  local nvm_script
  nvm_script="${PARKEX_NVM_SCRIPT:-${NVM_DIR:-$HOME/.nvm}/nvm.sh}"
  if [[ -s "$nvm_script" ]]; then
    # shellcheck source=/dev/null
    source "$nvm_script"
    nvm use 22 >/dev/null 2>&1 || \
      error "Node 22 no esta instalado en NVM. Ejecuta: nvm install 22"
  fi

  command -v node >/dev/null 2>&1 || error "No se encontro Node.js 22 o superior"
  node_mayor="$(node -p 'process.versions.node.split(".")[0]')"
  ((node_mayor >= 22)) || error "Se necesita Node.js 22 o superior; actual: $(node --version)"
}

uso_v4l2loopback() {
  lsmod | awk '$1 == "v4l2loopback" { print $3; encontrado=1 } END { if (!encontrado) print 0 }'
}

buscar_droidcam() {
  if [[ -n "${PARKEX_DROIDCAM_BIN:-}" ]]; then
    printf '%s\n' "$PARKEX_DROIDCAM_BIN"
  elif command -v droidcam >/dev/null 2>&1; then
    command -v droidcam
  elif [[ -x /usr/local/bin/droidcam ]]; then
    printf '%s\n' /usr/local/bin/droidcam
  fi

  return 0
}

trap 'detener_todo 130' INT TERM
trap 'detener_todo $?' EXIT

echo "== ParkEx: verificacion local =="
echo "Proyecto: $PROYECTO"

[[ -s "$API_ENV" ]] || error "Falta api/.env. Crealo a partir de api/.env.example"
[[ -s "$GATEWAY_ENV" ]] || error "Falta gateway/.env. Crealo a partir de gateway/.env.example"
[[ -s "$VISION_CONFIG" ]] || \
  error "Falta vision/config.json. Crealo a partir de vision/config.example.json"

exigir_env "$API_ENV" "SUPABASE_URL"
exigir_env "$API_ENV" "SUPABASE_SECRET_KEY"
exigir_env "$API_ENV" "PORT"
exigir_env "$API_ENV" "CORS_ORIGIN"
exigir_env "$GATEWAY_ENV" "PUERTO_SERIE"
exigir_env "$GATEWAY_ENV" "TOKEN_DISPOSITIVO"

python3 -c '
import json
import sys

config = json.load(open(sys.argv[1], encoding="utf-8"))
assert config.get("api_url"), "falta api_url"
assert config.get("hmac_secret"), "falta hmac_secret"
assert "PONER-ACA" not in config["hmac_secret"].upper(), "hmac_secret es un ejemplo"
assert config.get("camaras"), "no hay camaras"
assert all(camara.get("token") for camara in config["camaras"].values()), "falta un token de camara"
assert all("TOKEN" not in camara["token"].upper() for camara in config["camaras"].values()), "hay tokens de ejemplo"
' "$VISION_CONFIG" || error "vision/config.json es invalido o esta incompleto"

activar_node

for comando in npm java tesseract python3 curl ss; do
  command -v "$comando" >/dev/null 2>&1 || error "No se encontro el comando: $comando"
done

echo "[OK] Node $(node --version), Java y Tesseract disponibles"
mkdir -p "$LOGS"

if [[ ! -d "$PROYECTO/api/node_modules" ]]; then
  echo "Instalando dependencias de la API (solo la primera vez)..."
  (cd "$PROYECTO/api" && npm ci) || error "Fallo npm ci en api/"
fi

if [[ ! -d "$PROYECTO/gateway/node_modules" ]]; then
  echo "Instalando dependencias del gateway (solo la primera vez)..."
  (cd "$PROYECTO/gateway" && npm ci) || error "Fallo npm ci en gateway/"
fi

if [[ ! -f "$VISION_JAR" ]]; then
  command -v mvn >/dev/null 2>&1 || \
    error "No se encontro Maven y hace falta compilar vision/"
  echo "Compilando y probando el lector OCR (solo la primera vez)..."
  (cd "$PROYECTO/vision" && mvn clean package) || error "Fallo la compilacion del lector OCR"
fi

PUERTO_API="$(valor_env "$API_ENV" "PORT")"
PUERTO_SERIE="$(valor_env "$GATEWAY_ENV" "PUERTO_SERIE")"

[[ "$PUERTO_API" =~ ^[0-9]+$ ]] || error "PORT debe ser un numero en api/.env"
[[ "$PUERTO_WEB" =~ ^[0-9]+$ ]] || error "PARKEX_WEB_PORT debe ser un numero"
[[ -e "$PUERTO_SERIE" ]] || \
  error "No aparece $PUERTO_SERIE. Conecta el Arduino y revisa PUERTO_SERIE en gateway/.env"
[[ -r "$PUERTO_SERIE" && -w "$PUERTO_SERIE" ]] || \
  error "No hay permiso sobre $PUERTO_SERIE. En Linux, revisa el grupo dialout"

if command -v fuser >/dev/null 2>&1 && fuser "$PUERTO_SERIE" >/dev/null 2>&1; then
  error "$PUERTO_SERIE esta ocupado. Cierra el Monitor Serie del Arduino IDE u otro gateway"
fi
echo "[OK] Arduino disponible en $PUERTO_SERIE"

mapfile -t FUENTES_CAMARA < <(python3 -c '
import json
import sys

config = json.load(open(sys.argv[1], encoding="utf-8"))
for camara in config["camaras"].values():
    print(camara["fuente"])
' "$VISION_CONFIG")

NECESITA_DROIDCAM=false
for fuente in "${FUENTES_CAMARA[@]}"; do
  if [[ "$fuente" =~ ^[0-9]+$ ]]; then
    nombre_video=""
    if [[ -r "/sys/class/video4linux/video$fuente/name" ]]; then
      nombre_video="$(<"/sys/class/video4linux/video$fuente/name")"
    fi

    if [[ ! -e "/dev/video$fuente" ]] || [[ "$nombre_video" == *DroidCam* ]]; then
      NECESITA_DROIDCAM=true
    fi
  fi
done

if [[ "$NECESITA_DROIDCAM" == true ]]; then
  for comando in modinfo lsmod modprobe pgrep; do
    command -v "$comando" >/dev/null 2>&1 || error "No se encontro el comando: $comando"
  done

  modinfo v4l2loopback >/dev/null 2>&1 || \
    error "Falta instalar el modulo v4l2loopback para la camara virtual"

  DROIDCAM_BIN="$(buscar_droidcam)"
  [[ -n "$DROIDCAM_BIN" && -x "$DROIDCAM_BIN" ]] || \
    error "No se encontro DroidCam. Puedes indicar su ruta con PARKEX_DROIDCAM_BIN"

  if ! lsmod | awk '$1 == "v4l2loopback" { encontrado=1 } END { exit !encontrado }'; then
    command -v sudo >/dev/null 2>&1 || error "Se necesita sudo para cargar v4l2loopback"
    echo "Cargando la camara virtual (sudo puede pedir tu contrasena)..."
    sudo modprobe v4l2loopback exclusive_caps=1 card_label='DroidCam Virtual Camera'
  fi

  DROIDCAM_LISTO=false
  if pgrep -x droidcam >/dev/null && [[ "$(uso_v4l2loopback)" -gt 0 ]]; then
    DROIDCAM_LISTO=true
  fi

  if ! pgrep -x droidcam >/dev/null; then
    "$DROIDCAM_BIN" >"$LOGS/droidcam.log" 2>&1 &
    DROIDCAM_PID=$!
  fi

  if [[ "$DROIDCAM_LISTO" != true ]]; then
    echo
    echo "DroidCam esta abierto. Conecta el telefono y pulsa 'Virtual Camera Output'."
    read -r -p "Cuando veas el video, presiona Enter para continuar... "

    for _ in {1..10}; do
      if pgrep -x droidcam >/dev/null && [[ "$(uso_v4l2loopback)" -gt 0 ]]; then
        DROIDCAM_LISTO=true
        break
      fi
      sleep 0.5
    done

    [[ "$DROIDCAM_LISTO" == true ]] || \
      error "DroidCam esta abierto, pero no activaste 'Virtual Camera Output'"
  fi

  echo "[OK] DroidCam abierto y enviando video"
fi

for fuente in "${FUENTES_CAMARA[@]}"; do
  if [[ "$fuente" =~ ^[0-9]+$ ]]; then
    [[ -e "/dev/video$fuente" ]] || error "La camara configurada /dev/video$fuente no existe"
    [[ -r "/dev/video$fuente" && -w "/dev/video$fuente" ]] || \
      error "No hay permiso sobre /dev/video$fuente. En Linux, revisa el grupo video"
  fi
done
echo "[OK] Camaras configuradas disponibles"

puerto_ocupado "$PUERTO_API" && \
  error "El puerto $PUERTO_API ya esta ocupado; puede haber otra API levantada"
puerto_ocupado "$PUERTO_WEB" && \
  error "El puerto $PUERTO_WEB ya esta ocupado; puede haber otra web levantada"

echo
echo "== Iniciando servicios =="
iniciar_servicio "api" "$PROYECTO/api" node src/index.js

API_LISTA=false
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:$PUERTO_API/api/niveles" >/dev/null 2>&1; then
    API_LISTA=true
    break
  fi
  sleep 0.5
done

if [[ "$API_LISTA" != true ]]; then
  echo "La API no pudo consultar Supabase. Ultimas lineas:"
  tail -n 25 "$LOGS/api.log" || true
  error "Revisa api/.env"
fi
echo "[OK] API conectada a Supabase"

iniciar_servicio "web" "$PROYECTO" \
  python3 -m http.server "$PUERTO_WEB" --bind 127.0.0.1 --directory web
iniciar_servicio "gateway" "$PROYECTO/gateway" node src/index.js
iniciar_servicio "vision" "$PROYECTO/vision" java -jar "$VISION_JAR" service config.json

echo
echo "Todo esta levantado: http://localhost:$PUERTO_WEB"
echo "Logs: $LOGS"
echo "Presiona Ctrl+C para detener todo."

set +e
wait -n "${PIDS[@]}"
CODIGO=$?
set -e

for pid in "${PIDS[@]}"; do
  if ! kill -0 "$pid" 2>/dev/null; then
    nombre="${NOMBRES[$pid]}"
    echo
    echo "El servicio $nombre termino. Ultimas lineas:"
    tail -n 25 "$LOGS/$nombre.log" || true
    break
  fi
done

detener_todo "$CODIGO"
