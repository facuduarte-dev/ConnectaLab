# Lector de matrículas

Proceso Java que atiende las webcams de las plazas reservadas. Lee la chapa,
comprueba si lleva el distintivo de discapacidad y le reporta a la API el HMAC
de la matrícula. La sección 8 del README de la raíz explica el ciclo; acá está
cómo compilarlo, calibrarlo y qué hacer cuando no lee.

## Qué hace falta

| | Por qué |
|---|---|
| **JDK 17 o mayor** | El proyecto compila con `maven.compiler.release=17` |
| **Maven** | `mvn -v` para confirmarlo |
| **Tesseract OCR** | Es un binario aparte, no una dependencia de Maven. Ver abajo |

**Tesseract no se instala con `npm` ni con Maven.** En Windows se baja el
instalador de UB Mannheim; en Debian y derivados es `sudo apt install
tesseract-ocr`. El instalador de Windows **no lo agrega al PATH**, y por eso el
programa lo busca así, en este orden:

1. la variable de entorno `TESSERACT_PATH`, si está definida;
2. `C:\Program Files\Tesseract-OCR\tesseract.exe`, la ruta por defecto en Windows;
3. `tesseract` a secas, que es lo que funciona en Linux.

Todo eso vive en un solo lugar, `TesseractCli.rutaPorDefecto()`, y lo usan por
igual el modo `service` y los modos de prueba. Tenerlo duplicado fue un
problema real: durante un día entero el modo `camera` leía las chapas y el
servicio devolvía `no_verificable` en todas las lecturas, porque cada uno
resolvía la ruta por su cuenta.

## Compilar

```bash
mvn clean package
```

Deja `target/matricula-ocr-1.0.0.jar`, que trae OpenCV adentro y pesa unos
110 MB. No hace falta instalar OpenCV por separado.

## Configurar

```bash
cp config.example.json config.json
```

`config.json` está en `.gitignore` porque tiene secretos.

| Campo | Qué es |
|---|---|
| `api_url` | Dónde está la API. `http://localhost:3000` si corre en la misma máquina |
| `hmac_secret` | La clave del HMAC, 64 hex. **No la conoce nadie más, ni siquiera el backend**, pero tiene que ser estable: si cambia, las lecturas nuevas de un mismo vehículo dejan de coincidir con las viejas |
| `camaras` | Un objeto por plaza. La **clave es el id de la plaza en la base**, no el número de cámara |
| `camaras[].fuente` | El índice de la webcam (`"0"`, `"1"`…) o la URL de un stream. Va entre comillas siempre |
| `camaras[].token` | El token en claro del dispositivo de tipo `camara` de esa plaza |
| `capturas` | Cuántas fotos por evento. 8 |
| `ocurrencias_minimas` | Cuántas lecturas iguales hacen falta. 3 |
| `confianza_minima` | Por debajo de esto la lectura es `no_verificable`. 0,80 |

La clave y la fuente son dos números distintos y se confunden fácil:
`"1": { "fuente": "0" }` significa *la plaza 1, con la cámara 0*.

## Correr

```bash
java -jar target/matricula-ocr-1.0.0.jar service config.json
```

Al arrancar escribe qué plazas atiende. Después no dice nada hasta que alguna
esté en `pendiente`, que es cuando el sensor reporta que llegó un auto.

## Probar sin el circuito

```bash
# una foto fija
java -jar target/matricula-ocr-1.0.0.jar image imagenes/matricula1.png

# la cámara, tantas tomas como el servicio
java -jar target/matricula-ocr-1.0.0.jar camera 1

# el HMAC de una chapa conocida, para ubicarla en el historial
java -jar target/matricula-ocr-1.0.0.jar hash "SBI 5856"
```

Con `DEBUG_DIR` apuntando a una carpeta, el modo `camera` guarda cada captura y
además los recortes que el detector le pasa al OCR:

```bash
DEBUG_DIR=debug java -jar target/matricula-ocr-1.0.0.jar camera 1
```

Esos recortes son la mejor herramienta de diagnóstico que tiene el programa: si
en `debug/candidatos/` no aparece el número de la chapa, el problema es de
encuadre y no de OCR.

## Calibrar la cámara

Las lecturas individuales tienen que pasar de 0,80. Ninguna foto sola decide
nada —el consenso exige tres iguales— pero si todas rondan 0,60 el consenso
tampoco alcanza.

- **La chapa tiene que estar derecha.** El detector nivela el cuadro solo entre
  1,5° y 20°, pero cuanto menos tenga que corregir, mejor lee. Apoyala contra
  algo recto en vez de sostenerla a pulso.
- **Que entre completa y con margen.** Una matrícula cortada no pasa la
  validación de formato y se descarta entera.
- **En papel mate, no en una pantalla.** Una pantalla da brillo, bandeo y muaré.
- **Enfocada.** Tocá la chapa en la pantalla del teléfono si usás una cámara de
  celular, y alejate si estás por debajo de su distancia mínima de enfoque.

## Cuando algo no anda

| Lo que ves | Qué es |
|---|---|
| `El OCR no pudo correr: Cannot run program...` | Tesseract no está donde se lo busca. Definí `TESSERACT_PATH` con la ruta completa |
| `No se pudo abrir la cámara/stream` | La fuente no existe o está tomada por otro programa. Probá `camera 0`, `camera 1`, `camera 2` con `DEBUG_DIR` y mirá cuál es |
| Arranca y no dice nada más | Ninguna plaza está `pendiente`. El corte está antes: en el sensor o en el puente |
| `La plaza N está pendiente y ninguna cámara la atiende` | La clave de `camaras` no es el id de plaza correcto |
| `400 Falta distintivo_di` | El jar es anterior al cambio del distintivo. `mvn clean package` |
| Todas las lecturas dan `no_verificable`, confianza 0 | Si `camera` lee y el servicio no, es la ruta de Tesseract. Si tampoco lee `camera`, es el encuadre |
| Las primeras capturas salen de un solo color | Es el relleno de una cámara virtual. El programa descarta los primeros 3 s; si tu cámara tarda más, subí `capturas` |

## Cámaras virtuales

Una cámara virtual —DroidCam, OBS, Camo— sirve perfectamente como webcam de la
plaza, con dos advertencias.

**El índice no es estable.** Depende de qué programas estén abiertos. Antes de
cada sesión conviene confirmarlo con `camera N` y `DEBUG_DIR`.

**Tardan en entregar imagen.** DroidCam manda unos 2,5 s de cuadros de relleno
antes del video real. `CameraCapture` descarta los primeros 3 s justamente por
eso, y por eso también la cámara se abre por evento y no se deja abierta: fuera
de esos segundos no hay nada mirando la plaza (README 6.1).
