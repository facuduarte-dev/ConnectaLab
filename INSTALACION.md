# Instalación desde cero

Todo lo necesario para dejar ParkEx funcionando en una máquina que nunca clonó
el repositorio. Los comandos de sistema son para **Ubuntu/Debian**; en otras
distribuciones cambian los nombres de los paquetes, no los pasos.

La sección 11 del [README](README.md) explica el *porqué* de cada parte. Este
archivo es la secuencia de comandos, con un chequeo después de cada paso para no
avanzar sobre algo roto.

Para el orden de arranque del día a día, ver [GRABACION.md](GRABACION.md).

---

## 1. Herramientas del sistema

| Herramienta | Mínimo | Para qué |
|---|---|---|
| Java (JDK) | 17 | Compilar y correr el lector |
| Maven | 3.6 | Construir el lector |
| Node.js | 18 | API y puente serie (el puente usa `fetch` global) |
| Tesseract | 5.x | El OCR, con el idioma `eng` |
| Git | — | Clonar |

```bash
sudo apt update
sudo apt install git openjdk-17-jdk maven tesseract-ocr tesseract-ocr-eng
```

El idioma `eng` viene en un paquete aparte (`tesseract-ocr-eng`): sin él,
Tesseract instala pero no lee nada.

Node conviene instalarlo con [nvm](https://github.com/nvm-sh/nvm), porque el que
trae `apt` suele ser viejo:

```bash
nvm install 20
```

### Comprobar

```bash
java -version && mvn -v && node --version && tesseract --version && tesseract --list-langs
```

Java 17 o mayor, Node 18 o mayor, y `eng` en la lista de idiomas.

---

## 2. Clonar

```bash
git clone <url-del-repositorio> ConnectaLab
cd ConnectaLab
```

---

## 3. Base de datos

Crear un proyecto en [supabase.com](https://supabase.com) y correr, desde el
editor SQL y **en este orden**, los cuatro archivos de `db/`:

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `esquema.sql` | Tablas y tipos |
| 2 | `funciones.sql` | `registrar_evento()`, que usa el `PATCH` de la API |
| 3 | `datos_prueba.sql` | Dos niveles, 50 plazas y los dos dispositivos |
| 4 | `politicas.sql` | RLS y publicación de tiempo real |

El orden importa: `funciones.sql` usa los tipos que crea `esquema.sql`, y
saltear `politicas.sql` deja la base abierta a cualquiera que tenga la clave
pública, que está a la vista en el navegador.

### Comprobar

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

Todas las tablas con `rowsecurity` en `true`, y la segunda consulta tiene que
devolver `plazas`.

---

## 4. Tokens de dispositivo

Cada sensor y cada cámara se autentica con un token propio. En la base vive
**sólo el hash**; el token en claro se muestra una vez y no se vuelve a mostrar.

```bash
cd api
npm install
node scripts/crear_token_dispositivo.js
```

Imprime dos valores:

- **Token en claro** → va en `gateway/.env` (sensor) o en `vision/config.json` (cámara)
- **`token_hash`** → va en la columna `token_hash` de la tabla `dispositivos`

Hay que correrlo **una vez por dispositivo**. Para el circuito mínimo son dos:
el sensor de la plaza y la cámara.

---

## 5. Backend

```bash
cd api
npm install
cp .env.example .env
```

Completar `api/.env`:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://<id-del-proyecto>.supabase.co` |
| `SUPABASE_SECRET_KEY` | La *secret key* del proyecto (Project Settings → API Keys) |
| `PORT` | `3000` |
| `CORS_ORIGIN` | `http://localhost:5173` |

Cuidado con el nombre de la última: el código lee `CORS_ORIGIN`, en inglés. Si
se escribe `CORS_ORIGEN` la variable se ignora en silencio y CORS queda abierto
a cualquier origen.

La `SUPABASE_SECRET_KEY` saltea RLS y sólo se usa en el backend: nunca en el
frontend ni en el firmware.

```bash
npm run dev
```

### Comprobar

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```

---

## 6. Sitio web

No lleva `npm install`: son archivos estáticos.

```bash
npx serve -l 5173 web
```

Desde la raíz del repositorio. **Tiene que servirse por HTTP**, no abrirse como
archivo: con `file://` el navegador bloquea el `fetch` y rechaza los módulos ES,
con lo cual no carga ni una línea de JavaScript.

El puerto 5173 no es arbitrario, es el que autoriza `CORS_ORIGIN`.

---

## 7. Lector de matrículas

```bash
cd vision
cp config.example.json config.json
```

Completar `vision/config.json`:

| Clave | Qué va |
|---|---|
| `api_url` | `http://localhost:3000` |
| `hmac_secret` | 64 caracteres hexadecimales, generados una vez |
| `camaras` | Un objeto por plaza: **la clave es el id de la plaza** |
| `camaras.<id>.fuente` | El índice de la cámara, como texto (`"0"`, `"2"`) |
| `camaras.<id>.token` | El token en claro de esa cámara, del paso 4 |

Para generar el secreto del HMAC:

```bash
openssl rand -hex 32
```

**Ese secreto tiene que ser estable.** No lo conoce nadie más, ni siquiera el
backend, pero si cambia, las lecturas nuevas de un mismo vehículo dejan de
coincidir con las viejas y el historial de la plaza queda partido en dos. Si el
sistema se mueve a otra máquina, el secreto se copia tal cual.

Compilar:

```bash
mvn clean package
```

### Comprobar

Tienen que pasar **16 tests, 0 fallos**, y después:

```bash
java -jar target/matricula-ocr-1.0.0.jar image imagenes/prueba/escena_con_distintivo.png
```

Tiene que dar `IDI1483` con distintivo `sí`. La confianza puede variar un poco
según la versión de Tesseract; por debajo de 0,80 hay que mirar qué pasa.

---

## 8. Puente serie

```bash
cd gateway
npm install
cp .env.example .env
```

Completar `gateway/.env`:

| Variable | Valor |
|---|---|
| `PUERTO_SERIE` | `/dev/ttyACM0` en Linux, `COM3` o similar en Windows |
| `BAUDIOS` | `115200` |
| `API_URL` | `http://localhost:3000` |
| `TOKEN_DISPOSITIVO` | El token en claro del sensor, del paso 4 |
| `CONFIANZA_SENSOR` | `0.8` |

Para averiguar el puerto:

```bash
npm run puertos
```

En Linux el usuario tiene que estar en el grupo `dialout`, o no puede abrir el
puerto:

```bash
groups | grep dialout || sudo usermod -aG dialout $USER
```

Si hubo que agregarlo, hay que cerrar sesión y volver a entrar.

```bash
npm start
```

---

## 9. Firmware

Ver [firmware/README.md](firmware/README.md). Se abre `sensor_plaza.ino` en el
IDE de Arduino, se elige la placa **Arduino Uno** y su puerto, y se sube.

Las credenciales van en `firmware/sensor_plaza/credenciales.h`, que no está
versionado.

**Un puerto serie lo abre un solo programa a la vez.** Si el monitor del IDE
está abierto, el puente no puede abrir el puerto, y al revés. Es la causa número
uno de "no anda" en esta parte del sistema.

---

## 10. La cámara en Linux

Esta parte no está en el README y tiene una limitación que conviene saber antes
de perder tiempo.

### La fuente por URL no funciona

El OpenCV que trae el proyecto (`org.openpnp:opencv:4.9.0-0`) viene compilado
**sin FFMPEG** en Linux. Se comprueba así:

```bash
cd vision
printf 'nu.pattern.OpenCV.loadLocally();\nSystem.out.println(org.opencv.core.Core.getBuildInformation());\n/exit\n' \
  | jshell -q --class-path target/matricula-ocr-1.0.0.jar | grep -i ffmpeg
```

Si dice `FFMPEG: NO`, `VideoCapture` no puede abrir un stream MJPEG por HTTP.
Es decir: **la fuente `http://IP:4747/video` del `config.example.json` no sirve
en Linux.** Hay que usar una cámara virtual y pasar un índice.

### Cámara virtual con DroidCam

```bash
sudo apt install v4l-utils           # opcional, para diagnóstico
sudo modprobe v4l2loopback exclusive_caps=1 card_label='DroidCam Virtual Camera'
```

En Ubuntu con kernel reciente `v4l2loopback` viene incluido y firmado, así que
funciona con Secure Boot activado. Si la distribución no lo trae, se instala con
`sudo apt install v4l2loopback-dkms`, y ahí sí Secure Boot puede rechazar el
módulo por no estar firmado.

Después se instala el cliente de DroidCam y se abre **siempre después** de haber
cargado el módulo:

```bash
/usr/local/bin/droidcam
```

Conectar el teléfono por WiFi y apretar **Virtual Camera Output**.

### Comprobar

```bash
lsmod | grep v4l2loopback     # el último número tiene que ser distinto de 0
ls /dev/video*                # anotar el índice de 'DroidCam Virtual Camera'
```

Y una prueba de un solo cuadro, que no necesita la API ni el puente ni el
Arduino:

```bash
cd vision
DEBUG_DIR=debug CAPTURE_COUNT=1 java -jar target/matricula-ocr-1.0.0.jar camera <indice>
```

Si aparece la línea `Toma 1:`, la cámara funciona.

---

## 11. Verificación del circuito completo

Con la API levantada, estas dos peticiones tienen que responder
**`"Faltan campos"`**. Eso confirma que el token es válido y que el dispositivo
cubre esa plaza, sin escribir nada en la base:

```bash
curl -s -X POST http://localhost:3000/api/eventos \
  -H "Authorization: Bearer <token-del-puente>" \
  -H "Content-Type: application/json" -d '{"plaza_id":1}'
```

```bash
curl -s -X POST http://localhost:3000/api/lecturas \
  -H "Authorization: Bearer <token-de-la-camara>" \
  -H "Content-Type: application/json" -d '{"plaza_id":1}'
```

Un **401** es token inválido y un **403** es que el dispositivo no cubre esa
plaza.

---

## Rendimiento

El OCR es pesado y el tiempo depende mucho de la máquina. Referencia medida
sobre un Celeron N4500 de dos núcleos, que es el peor caso del proyecto:

| Caso | Tiempo |
|---|---|
| Una escena de 1600×1200 | ~22 s |
| Un cuadro de DroidCam de 1280×720 | ~12 s |
| Un ciclo completo de 6 capturas | ~80 s |

En una máquina de escritorio normal esto baja mucho. Si el hardware es lento y
alguna imagen da `no_verificable` con un mensaje de que Tesseract se pasó del
límite de tiempo, la constante está en `SEGUNDOS_LIMITE`, en
`vision/src/main/java/com/parkex/ocr/TesseractCli.java`.

---

## Archivos que no se versionan

Estos hay que crearlos a mano en cada instalación; están en `.gitignore` porque
contienen secretos o datos personales:

| Archivo | Se crea desde |
|---|---|
| `api/.env` | `api/.env.example` |
| `gateway/.env` | `gateway/.env.example` |
| `vision/config.json` | `vision/config.example.json` |
| `firmware/sensor_plaza/credenciales.h` | Ver `firmware/README.md` |

`vision/debug/`, `vision/capturas/` y `vision/recortes/` guardan fotos de
vehículos y matrículas reales: son datos personales bajo la ley 18.331 y
tampoco se versionan.
