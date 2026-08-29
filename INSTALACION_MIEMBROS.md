# Instalación para miembros del proyecto

Para quien se suma al equipo y va a trabajar contra **la base de Supabase que ya
usamos todos**. Es más corto que [INSTALACION.md](INSTALACION.md), pero tiene
tres cosas que ahí no aplican y que si se hacen mal le rompen el entorno al
resto.

Si lo que querés es montar una instalación **independiente**, con tu propia base
y tus propios dispositivos, este archivo no es el tuyo: usá
[INSTALACION.md](INSTALACION.md).

---

## Antes que nada: tres cosas que NO hay que hacer

### 1. No crees un proyecto nuevo en Supabase

Usás el que ya existe. La URL y la clave vienen en el `api/.env` que te pasa
alguien del equipo.

### 2. No corras los archivos de `db/`

`esquema.sql`, `funciones.sql`, `datos_prueba.sql` y `politicas.sql` son para
**inicializar una base vacía**. Contra la base compartida, `datos_prueba.sql`
choca con los id que ya existen, y en el peor caso pisa datos que otro estaba
usando.

La base ya está montada. No hay nada que correr.

### 3. No generes tokens de dispositivo nuevos

`crear_token_dispositivo.js` genera un par token/hash nuevo. El hash hay que
escribirlo en la tabla `dispositivos` de la base compartida — y en cuanto lo
hacés, **el token que tienen los demás deja de funcionar**, porque en esa
columna entra uno solo.

Los tokens en claro ya existen. Se piden, no se generan.

---

## 1. Herramientas del sistema

Igual que en una instalación normal:

```bash
sudo apt update
sudo apt install git openjdk-17-jdk maven tesseract-ocr tesseract-ocr-eng
```

Node 22 o mayor, preferentemente con [nvm](https://github.com/nvm-sh/nvm).

Comprobar:

```bash
java -version && mvn -v && node --version && tesseract --list-langs
```

Java 17 o mayor, Node 22 o mayor, y `eng` entre los idiomas.

---

## 2. Clonar e instalar dependencias

```bash
git clone <url-del-repositorio> ConnectaLab
cd ConnectaLab
cd api && npm install && cd ..
cd gateway && npm install && cd ..
```

`web/` es estático y no lleva `npm install`.

---

## 3. Pedir los tres archivos de configuración

Ninguno está en el repositorio: los tres están en `.gitignore` porque tienen
secretos. Hay que pedírselos a alguien que ya tenga el entorno andando.

| Archivo | Qué trae |
|---|---|
| `api/.env` | URL y clave secreta de Supabase |
| `gateway/.env` | Token del puente |
| `vision/config.json` | Token de la cámara y la clave del HMAC |

**No los pases por un canal público.** Y una vez que los tenés, no los
commitees: `.gitignore` ya los cubre, pero un `git add -f` los sube igual.

---

## 4. Qué es compartido y qué es tuyo

Esta es la parte que más confusión genera. De los archivos que te pasaron, hay
valores que **tienen que quedar exactamente como vinieron** y otros que
**tenés que cambiar** por los de tu máquina.

### Compartido — no lo toques

| Dónde | Clave | Por qué |
|---|---|---|
| `api/.env` | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Es la base de todos |
| `gateway/.env` | `TOKEN_DISPOSITIVO` | El hash en la base es de *ese* token |
| `vision/config.json` | `camaras.<id>.token` | Ídem |
| `vision/config.json` | `hmac_secret` | Ver abajo, es el más delicado |
| `vision/config.json` | la clave del mapa `camaras` | Es el **id de la plaza**, no un número de cámara |

### Tuyo — ajustalo a tu máquina

| Dónde | Clave | Valor típico |
|---|---|---|
| `gateway/.env` | `PUERTO_SERIE` | `/dev/ttyACM0` en Linux, `COM3` en Windows |
| `vision/config.json` | `camaras.<id>.fuente` | El índice de **tu** cámara |
| `api/.env` | `CORS_ORIGIN` | `http://localhost:5173` |

Para averiguar el puerto serie: `cd gateway && npm run puertos`.

---

## 5. La clave del HMAC: verificala

De todos los valores compartidos, `hmac_secret` es el que más silenciosamente
rompe las cosas.

Con esa clave se calcula el hash de cada matrícula. La matrícula en sí **nunca**
se guarda; en la base vive sólo el hash. Si tu clave difiere aunque sea en un
carácter, tus lecturas generan hashes distintos y el sistema no las reconoce
como el mismo vehículo que ya venían viendo los demás: el historial de la plaza
queda partido en dos, sin ningún error visible.

Para comprobar que la tuya coincide sin pasarle la clave a nadie, cada uno corre
esto y comparan los doce caracteres:

```bash
grep -oP '"hmac_secret"\s*:\s*"\K[^"]+' vision/config.json | tr -d '\n' | sha256sum | cut -c1-12
```

Es un hash de la clave, así que se puede mandar por cualquier lado. Si los dos
valores no son idénticos, algo se copió mal.

---

## 6. Compilar el lector

```bash
cd vision
mvn clean package
```

Tienen que pasar **16 tests, 0 fallos**.

Comprobar contra una imagen de referencia:

```bash
java -jar target/matricula-ocr-1.0.0.jar image imagenes/prueba/escena_con_distintivo.png
```

Tiene que dar `IDI1483` con distintivo `sí`. La confianza varía un poco según la
versión de Tesseract y la máquina; por debajo de 0,80 hay que mirar qué pasa.

---

## 7. La cámara

No cambia respecto de una instalación normal, y en Linux tiene una trampa
importante: el OpenCV del proyecto viene **sin FFMPEG**, así que la fuente por
URL (`http://IP:4747/video`) no funciona y hay que usar una cámara virtual con
índice.

Está todo en la [sección 10 de INSTALACION.md](INSTALACION.md#10-la-cámara-en-linux).

Acordate de ajustar `fuente` con **tu** índice: el que venía en el archivo que te
pasaron es el de la máquina de esa persona.

---

## 8. Levantar todo

Cuatro terminales, en este orden:

```bash
cd api && npm run dev
```

```bash
npx serve -l 5173 web
```

```bash
cd gateway && npm start
```

```bash
cd vision && java -jar target/matricula-ocr-1.0.0.jar service config.json
```

El orden de arranque completo, con la cámara y los chequeos de cada paso, está
en [GRABACION.md](GRABACION.md).

---

## 9. Comprobar que tus tokens son los buenos

Con la API levantada, estas dos peticiones tienen que responder
**`"Faltan campos"`**. Eso confirma que el token pasa la autenticación y que el
dispositivo cubre esa plaza, sin escribir nada en la base compartida:

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

Un **401** significa que tu token no coincide con el hash de la base: lo
copiaste mal, o alguien lo regeneró y hay que pedirlo de nuevo. Un **403**
significa que el dispositivo no cubre esa plaza.

---

## Cuidado: la base es de verdad

Todo lo que hagas contra tu entorno local **escribe en la base que usan los
demás**. No hay una copia de desarrollo separada.

En la práctica:

- Correr el lector en modo `service` inserta lecturas reales.
- Ocupar una plaza desde el sensor cambia el estado que los demás ven en su web.
- Las fotos que quedan en `vision/debug/`, `vision/capturas/` y
  `vision/recortes/` son de vehículos y matrículas reales. Son datos personales
  bajo la ley 18.331: no se versionan y no se comparten.

Si vas a probar algo que ensucia datos, avisale al equipo antes.
