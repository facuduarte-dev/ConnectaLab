# ParkEx — lector de matrículas

Lector Java/OpenCV/Tesseract para fotos, webcams USB, cámara virtual de DroidCam y streams HTTP. No guarda imágenes ni envía matrículas en claro.

## Compilar y probar

Requiere Java 17+, Maven y Tesseract 5. En Windows detecta `C:\\Program Files\\Tesseract-OCR\\tesseract.exe`; para otra ubicación se usa `TESSERACT_PATH`.

```powershell
mvn clean verify
java -jar target/matricula-ocr-1.0.0.jar image imagenes/matricula1.png
```

## Cámara real / DroidCam

DroidCam instalado en el iPhone y Windows aparece como webcam virtual. Probar índices 0, 1 y 2:

```powershell
java -jar target/matricula-ocr-1.0.0.jar camera 1
```

También admite un stream compatible con OpenCV:

```powershell
java -jar target/matricula-ocr-1.0.0.jar camera "http://192.168.1.20:4747/video"
```

Para una demostración estable conviene usar USB, montar el teléfono fijo y bloquear enfoque/exposición. La matrícula debería ocupar al menos 150 px de ancho y verse con poca inclinación.

Variables: `CAPTURE_COUNT` (8), `CAPTURE_INTERVAL_MS` (1200), `MIN_CONFIDENCE` (0.80), `MIN_OCCURRENCES` (2), `TESSERACT_PATH` y `HMAC_SECRET` (mínimo 32 caracteres). Sin consenso confiable el resultado siempre es `no_verificable`.

Para calibrar una cámara, `DEBUG_DIR=debug` guarda temporalmente las capturas en esa carpeta. Estas imágenes son sólo de diagnóstico local y deben eliminarse al terminar; el modo normal no guarda ninguna.

El validador admite `ABC1234` (Mercosur), `ABC123` (formato uruguayo anterior) y `1234ABC` para conservar la imagen española incluida como fixture. En producción se recomienda restringir los patrones a los usados por el parking.

## Integración pendiente

`ConnectaLab` documenta `GET /api/lecturas/pendientes` y `POST /api/lecturas`, pero aún no implementa esas rutas. Cuando existan, el servicio debe enviar sólo `plaza_id`, `matricula_hash` y `confianza` usando el token Bearer.
