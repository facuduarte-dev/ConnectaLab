# Checklist de grabación

Orden exacto para dejar el circuito completo funcionando en la máquina Linux.
Para instalar desde cero, ver [INSTALACION.md](INSTALACION.md).

Verificado el 25/08/2026 sobre un Celeron N4500 de dos núcleos, que es la
máquina lenta del proyecto: los tiempos de abajo son de ahí.

---

## Parte 1 — La cámara

Es la parte frágil y va **primero**, antes de levantar cualquier servicio.

### 1. Enchufar el Arduino

```bash
ls /dev/ttyACM*
```

Tiene que aparecer `/dev/ttyACM0`. Si no aparece, revisar el cable y que el
monitor serie del IDE de Arduino esté cerrado.

### 2. Cargar el módulo de cámara virtual

**Este paso va antes de abrir DroidCam.** No es un detalle de estilo: DroidCam
enumera los dispositivos de video una sola vez, al arrancar. Si el módulo se
carga después, la app queda con una lista vieja y el botón de cámara virtual no
encuentra a dónde escribir.

```bash
sudo modprobe v4l2loopback exclusive_caps=1 card_label='DroidCam Virtual Camera'
```

Si ya estaba cargado de una sesión anterior, descargarlo primero:

```bash
sudo modprobe -r v4l2loopback
```

Los dos parámetros importan. `card_label` es el nombre que DroidCam busca, y
`exclusive_caps=1` hace que el dispositivo se anuncie como capturable sólo
cuando algo le está escribiendo — sin eso, OpenCV lo abre igual y devuelve
cuadros vacíos, que es un fallo mudo y difícil de diagnosticar.

`modprobe` **no sobrevive un reinicio**. Si se reinicia la máquina, este paso se
rehace.

### 3. Abrir DroidCam y conectar el teléfono

```bash
/usr/local/bin/droidcam
```

Conectar el teléfono por WiFi (no por USB) y apretar **Virtual Camera Output**.
El video del teléfono tiene que verse en la vista previa: si ahí no se ve nada,
el problema es la conexión con el teléfono y no el loopback.

### 4. Confirmar que está emitiendo

Este chequeo cuesta un segundo y ahorra mucho tiempo:

```bash
lsmod | grep v4l2loopback
```

El último número es cuántos lo están usando. **Tiene que ser distinto de 0.**
Si es 0, DroidCam no está volcando el video: revisar el paso 3.

### 5. Confirmar el índice

```bash
ls /dev/video*
```

El índice puede cambiar al recargar el módulo. `DroidCam Virtual Camera` suele
quedar en `/dev/video2`, o sea índice `2`. Si quedó en otro, ajustar `"fuente"`
en `vision/config.json`.

---

## Parte 2 — Los cuatro servicios

Cuatro terminales, en este orden. La API va primera porque el puente y el lector
dependen de ella.

### 6. API

```bash
cd api && npm run dev
```

Esperar `ConectaLAB API escuchando en http://localhost:3000`.

### 7. Web

```bash
npx serve -l 5173 web
```

Desde la raíz del repositorio, no desde `web/`. El puerto **tiene** que ser 5173:
es el único que autoriza `CORS_ORIGIN` en `api/.env`.

### 8. Puente serie

```bash
cd gateway && npm start
```

Es `start`, no `dev` — en `gateway/package.json` no existe un script `dev`.

### 9. Lector de matrículas

```bash
cd vision && java -jar target/matricula-ocr-1.0.0.jar service config.json
```

Tiene que imprimir `Servicio de lectura: 1 cámaras (plazas [1]), API http://localhost:3000`.

---

## Parte 3 — Cómo se dispara una lectura

El lector no captura todo el tiempo. Cada 5 segundos le pregunta a
`GET /api/lecturas/pendientes` y sólo actúa sobre las plazas que están
**ocupadas y sin lectura resuelta**. La cadena es:

```
sensor del Arduino  →  puente  →  POST /api/eventos  →  plaza ocupada
                                                            ↓
                                        el lector la ve como pendiente
                                                            ↓
                                          captura, OCR y POST /api/lecturas
```

Para la toma: poner la chapa frente al teléfono **antes** de disparar el sensor.

**Contar unos 80 segundos** desde que se ocupa la plaza hasta que aparece el
resultado: son 6 capturas a ~12 s cada una más el descarte de calentamiento. No
es instantáneo y conviene tenerlo previsto en el guion.

---

## Parte 4 — Si algo falla en vivo

| Síntoma | Causa | Arreglo |
|---|---|---|
| El lector no captura nada, sin error, termina en ~10 s | DroidCam dejó de emitir | `lsmod \| grep v4l2loopback`; si da 0, reiniciar DroidCam |
| `No se pudo abrir la cámara/stream: 2` | El módulo está pero nadie le escribe | Mismo arreglo |
| La web no trae datos | Se sirvió en otro puerto | Tiene que ser 5173 |
| El puente no abre el puerto serie | El monitor del IDE de Arduino está abierto | Cerrarlo: un puerto serie lo abre un solo programa a la vez |
| Todas las lecturas dan `no_verificable` | Tesseract no está en el PATH | `command -v tesseract` |

Para distinguir "no llegó ningún cuadro" de "el OCR falló": `saveDebugFrame()`
escribe en `debug/` **antes** de correr el OCR. Si no hay un `captura_1.jpg`
nuevo, el problema está en la cámara y el OCR ni se ejecutó.

---

## Notas

- **Luz sobre la chapa.** En la prueba del 25/08 una de las seis tomas quedó
  justo en 0,80, pegada al umbral de `confianza_minima`, y otra no dio lectura.
  El consenso lo absorbió —pide 3 coincidencias y hubo 5— pero con más luz sobra
  margen.
- **La marca de agua** `using droidcam.app` de la versión gratuita queda abajo
  de la imagen y no molesta a la detección.
- **El modo cámara de la CLI es autónomo**: no toca la API, ni el puente, ni el
  Arduino. Para probar sólo la cámara sin levantar nada más:

  ```bash
  cd vision && DEBUG_DIR=debug CAPTURE_COUNT=1 java -jar target/matricula-ocr-1.0.0.jar camera 2
  ```

  Si aparece la línea `Toma 1:`, la cámara funciona. Si no aparece ninguna, no
  está llegando video.
