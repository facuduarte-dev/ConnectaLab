# ConectaLAB — Documento del proyecto

Sistema de gestión inteligente de estacionamiento para la ciudad de Montevideo.

---

## 1. Problema y objetivo

Montevideo tiene una densidad automovilística creciente y buscar estacionamiento
genera vueltas innecesarias, congestión y consumo de combustible. Además, las
plazas reservadas para personas con discapacidad son frecuentemente ocupadas por
vehículos no autorizados, sin forma práctica de detectarlo.

**Objetivo:** una plataforma web que muestre en un mapa, en tiempo real, qué
plazas de estacionamiento están libres, ocupadas o reservadas para personas discapacitadas, alimentada por
sensores físicos instalados en la vía.

**No es objetivo (por ahora):** cobro de tarifas, control de acceso con barreras,
ni fiscalización automática de infracciones.

---

## 2. Arquitectura

### 2.1 Flujo de datos

```
Sensor ultrasónico (HC-SR04)
        │  detecta un objeto a menos de X cm
        ▼
ESP32  ─── WiFi ──────────────────┐
        │                          │
        │  (opcional, si hay       │
        │   cámara en esa zona)    │
        ▼                          │
Servicio de visión (Python + YOLO) │
        │  confirma: ¿es un auto?  │
        ▼                          │
        └──────────────────────────┤
                                   ▼
                         API REST (Node.js + Express)
                         POST /eventos  ← valida y normaliza
                                   │
                                   ▼
                         Base de datos (Supabase / PostgreSQL)
                         · escribe en `eventos` (historial)
                         · actualiza `plazas` (estado actual)
                                   │
                                   ▼
                         Supabase Realtime
                         notifica el cambio a los navegadores conectados
                                   │
                                   ▼
                         Sitio web (HTML/CSS/JS + Leaflet)
                         repinta el marcador de la plaza
```

### 2.2 Principio de diseño: el sistema funciona sin cámara

La visión por computadora es una **capa de confirmación**, no el camino crítico.
El sensor ultrasónico es la fuente principal del estado; YOLO sirve para elevar
la confianza del dato y descartar falsos positivos (una persona parada, una
moto, una bolsa de basura, un cono).

Si el servicio de visión está caído o no existe en una zona, el sistema sigue
funcionando con `confianza` más baja. Esta decisión evita que una falla en la
parte más compleja del proyecto tire abajo todo lo demás.

---

## 3. Stack tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| Frontend | HTML, CSS, JavaScript | Sin framework: el proyecto no lo necesita y suma complejidad |
| Mapa | Leaflet + OpenStreetMap | Gratuito, la usa Copay con su GPS |
| Backend | Node.js + Express | Mismo lenguaje que el frontend, arranque rápido, ecosistema amplio |
| Base de datos | Supabase (PostgreSQL) | Base de datos + autenticación + tiempo real en un solo servicio, con plan gratuito |
| Autenticación | Supabase Auth | Resuelve el inicio de sesión sin implementar manejo de contraseñas |
| Tiempo real | Supabase Realtime | Notifica cambios de fila a los navegadores sin escribir WebSockets a mano |
| Visión | Python + ultralytics (YOLO) | YOLO no existe como librería de JavaScript ni corre en el ESP32 |
| OCR | EasyOCR | Mejor desempeño en matrículas que Tesseract, que está pensado para texto de documentos |
| Firmware | ESP32 (Arduino IDE / PlatformIO) | WiFi integrado, emite el HTTP directamente |
| Sensor | HC-SR04 (ultrasónico) | Bajo costo, disponible localmente, suficiente para el prototipo |

### 3.1 Decisiones descartadas y por qué

- **Java (Spring Boot):** se descartó por duplicar el rol de Node.js. Tener dos
  backends en dos lenguajes significa mantener dos configuraciones, dos
  despliegues y dos conjuntos de dependencias sin ganancia funcional.
- **MySQL:** se descartó porque Supabase ya provee PostgreSQL. Usar ambos
  implicaría sincronizar dos bases de datos.
- **Google Maps:** se descartó por requerir tarjeta de crédito y tener límites
  de uso en el plan gratuito.

---

## 4. Modelo de datos

### 4.1 Diseño

La separación entre **estado actual** e **historial** es la decisión central:

- `plazas` guarda el estado presente. Es la tabla que consulta el mapa, tiene
  pocas filas y responde rápido.
- `eventos` guarda todo lo que pasó. Nunca se borra ni se actualiza. Sirve para
  auditoría, estadísticas de ocupación por hora y para diagnosticar fallas de
  sensores.

### 4.2 Esquema

```sql
create table zonas (
  id          serial primary key,
  nombre      text not null,
  lat         double precision not null,
  lng         double precision not null
);

create type tipo_plaza   as enum ('normal', 'discapacidad', 'carga');
create type estado_plaza as enum ('libre', 'ocupado', 'reservado', 'sin_datos');

-- Solo aplica a plazas de tipo 'discapacidad'
create type autorizacion_plaza as enum (
  'no_aplica', 'pendiente', 'autorizado', 'no_autorizado', 'no_verificable'
);

create table plazas (
  id             serial primary key,
  zona_id        integer not null references zonas(id),
  codigo         text not null unique,
  lat            double precision not null,
  lng            double precision not null,
  tipo           tipo_plaza         not null default 'normal',
  estado         estado_plaza       not null default 'sin_datos',
  autorizacion   autorizacion_plaza not null default 'no_aplica',
  actualizado_en timestamptz        not null default now()
);

create type fuente_evento as enum ('sensor', 'camara', 'manual');

create table eventos (
  id         bigserial primary key,
  plaza_id   integer not null references plazas(id),
  estado     estado_plaza  not null,
  fuente     fuente_evento not null,
  confianza  real not null default 1.0,
  creado_en  timestamptz not null default now()
);

create index eventos_plaza_fecha on eventos (plaza_id, creado_en desc);

create table dispositivos (
  id           serial primary key,
  plaza_id     integer not null references plazas(id),
  token_hash   text not null,
  descripcion  text,
  activo       boolean not null default true,
  ultimo_ping  timestamptz
);

-- Padron local de permisos. Guarda el HMAC de la matricula, nunca la matricula.
create table permisos_discapacidad (
  id             serial primary key,
  matricula_hash text not null unique,
  etiqueta       text,
  vigente_desde  date not null default current_date,
  vigente_hasta  date,
  activo         boolean not null default true
);

create table lecturas_matricula (
  id             bigserial primary key,
  plaza_id       integer not null references plazas(id),
  matricula_hash text,            -- null cuando el OCR no pudo leerla
  confianza      real not null,
  resultado      autorizacion_plaza not null,
  creado_en      timestamptz not null default now()
);

-- Para revision humana. El sistema no sanciona automaticamente.
create table alertas (
  id           bigserial primary key,
  plaza_id     integer not null references plazas(id),
  lectura_id   bigint references lecturas_matricula(id),
  motivo       text not null,
  revisada     boolean not null default false,
  revisada_por uuid,
  revisada_en  timestamptz,
  creado_en    timestamptz not null default now()
);
```

Los usuarios los administra Supabase Auth en su propio esquema; no se crea una
tabla `usuarios` propia.

El archivo completo, con índices y políticas de Row Level Security, está en
[`db/esquema.sql`](db/esquema.sql).

**Por qué `autorizacion` es una columna aparte y no un valor de `estado`:** una
plaza de discapacidad ocupada por un auto sin permiso sigue estando *ocupada*.
Son dos preguntas independientes — "¿hay un auto?" y "¿tiene permiso?" — y
mezclarlas en un solo campo obligaría a duplicar cada estado por cada nivel de
autorización.

### 4.3 Reglas de negocio

- Un evento nunca modifica `plazas` directamente desde el cliente. El backend
  escribe el evento y luego actualiza el estado.
- Si llegan un evento de `sensor` y uno de `camara` contradictorios dentro de la
  misma ventana de 10 segundos, gana el de `camara` (mayor confianza).
- Si una plaza no reporta ningún evento durante 30 minutos, pasa a `sin_datos`.
  Es preferible mostrar "sin información" a mostrar información vieja como si
  fuera actual.

---

## 5. API

Todos los endpoints bajo `/api`.

### Públicos (lectura)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/zonas` | Lista de zonas con conteo de plazas libres/ocupadas |
| `GET` | `/api/plazas` | Todas las plazas con su estado actual |
| `GET` | `/api/plazas/:id` | Detalle de una plaza |

### Dispositivos (requieren token de dispositivo)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/eventos` | Registra una detección de ocupación |
| `POST` | `/api/matriculas` | Registra una lectura de matrícula |

Cuerpo de `/api/eventos`:

```json
{
  "plaza_id": 12,
  "estado": "ocupado",
  "fuente": "sensor",
  "confianza": 0.8
}
```

Cuerpo de `/api/matriculas` — obsérvese que **no lleva la matrícula**, solo su
hash (ver sección 9):

```json
{
  "plaza_id": 3,
  "matricula_hash": "9f86d081884c7d65...",
  "confianza": 0.93
}
```

Si el OCR no pudo leer nada, se envía `"matricula_hash": null` y el backend
responde `no_verificable`.

El token va en el header `Authorization: Bearer <token>`. El backend verifica
que el token corresponda a un dispositivo asociado a esa `plaza_id`: un
dispositivo no puede reportar por una plaza que no es la suya.

### Administración (requieren sesión de usuario)

| Método | Ruta | Descripción |
|---|---|---|
| `PATCH` | `/api/plazas/:id` | Cambio manual de estado |
| `GET` | `/api/eventos?plaza_id=&desde=&hasta=` | Historial |
| `GET` | `/api/matriculas/alertas` | Bandeja de alertas pendientes de revisión |

---

## 6. Seguridad

- **La clave de servicio de Supabase vive solo en el backend.** Nunca en el
  firmware del ESP32 ni en el JavaScript del navegador.
- **El frontend usa la clave pública (anon) con Row Level Security activado.**
  Las políticas permiten lectura de `plazas` y `zonas` a cualquiera, y escritura
  a nadie.
- **Cada dispositivo tiene su propio token.** Se guarda hasheado en la base. Si
  un ESP32 es manipulado físicamente, se revoca ese token sin afectar al resto.
- **El endpoint de eventos tiene límite de tasa.** Un sensor con falla que emita
  cientos de eventos por segundo no debe poder llenar la base.
- **Las credenciales van en variables de entorno**, nunca versionadas. El repo
  incluye `.env.example` con los nombres de las variables pero sin valores.

---

## 7. Hardware

### 7.1 Circuito

ESP32 + HC-SR04:

| HC-SR04 | ESP32 |
|---|---|
| VCC | 5V |
| TRIG | GPIO 5 |
| ECHO | GPIO 18 (mediante divisor de tensión a 3.3V) |
| GND | GND |

**Importante:** el pin ECHO del HC-SR04 emite 5V y el ESP32 tolera 3.3V en sus
entradas. Hay que intercalar un divisor de tensión (por ejemplo 1kΩ + 2kΩ) o el
ESP32 se daña con el tiempo.

### 7.2 Lógica del firmware

1. Medir distancia cada 500 ms.
2. Considerar la plaza ocupada si la distancia baja del umbral durante 3
   lecturas consecutivas (evita disparos por una persona que pasa caminando).
3. Considerar la plaza libre si supera el umbral durante 5 lecturas seguidas.
4. Emitir el POST **solo cuando el estado cambia**, no en cada lectura.
5. Enviar un ping cada 10 minutos aunque no haya cambios, para que el backend
   sepa que el sensor sigue vivo.

### 7.3 Limitaciones conocidas del HC-SR04

Documentadas explícitamente porque afectan la viabilidad en vía pública:

- Alcance útil de aproximadamente 2 cm a 4 m.
- Cono de detección ancho (~15°): puede detectar objetos de plazas vecinas.
- La velocidad del sonido varía con la temperatura, lo que corre las mediciones
  entre invierno y verano.
- Superficies blandas o en ángulo absorben o desvían el eco.
- A la intemperie, la lluvia y la suciedad degradan las lecturas.

**Montaje recomendado:** sensor elevado apuntando hacia abajo (poste, techo), no
a nivel del piso. En estacionamiento techado el desempeño es notablemente mejor
que en cordón abierto.

**Alternativa a evaluar más adelante:** sensores magnéticos embebidos en el
pavimento, que es lo que se usa en implementaciones reales de smart parking.

---

## 8. Servicio de visión

Proceso Python independiente, corriendo en una computadora (no en el ESP32).

- Modelo: YOLO preentrenado en COCO, que ya reconoce las clases `car`, `truck`,
  `bus`, `motorcycle` y `person` sin necesidad de entrenar nada propio.
- Entrada: cámara de celular usada como webcam IP, o webcam USB.
- **Una cámara cubre varias plazas.** Se definen regiones de interés (ROI)
  rectangulares sobre la imagen, una por plaza, y se evalúa qué detecciones caen
  dentro de cada región.
- Salida: `POST /api/eventos` con `fuente: "camara"` y la confianza que devuelve
  el modelo.
- Si la plaza es de tipo `discapacidad` y hay un vehículo, el recorte de ese
  vehículo pasa al pipeline de lectura de matrícula (sección 9).

Una cámara por plaza sería inviable en costo y en ancho de banda; el diseño por
regiones de interés es lo que hace que esto escale.

---

## 9. Verificación de matrículas por OCR

En las plazas de tipo `discapacidad`, cuando la cámara detecta un vehículo se
intenta leer la matrícula y contrastarla contra un padrón de permisos.

### 9.1 El pipeline

Son cuatro etapas encadenadas. Cada una recibe el recorte que produjo la
anterior:

| # | Etapa | Qué hace | Dónde está |
|---|---|---|---|
| 1 | Detección del vehículo | YOLO encuentra el auto dentro de la región de interés de la plaza | `detectar.py` |
| 2 | Localización de la chapa | Un segundo modelo YOLO busca la matrícula **dentro del recorte del auto** | `localizar_matricula()` |
| 3 | Rectificación | Corrige la perspectiva, pasa a escala de grises y binariza | `rectificar()` |
| 4 | OCR y normalización | EasyOCR lee el texto y se lo valida contra el formato de matrícula | `leer_texto()`, `normalizar()` |

**Por qué la etapa 2 trabaja sobre el recorte y no sobre la imagen completa:**
buscar una chapa en toda la escena produce muchísimos más falsos positivos
(carteles, chapas de otras plazas, texto en la calle). Acotar la búsqueda al
área donde ya se sabe que hay un auto mejora la precisión de forma notable.

**Por qué la etapa 3 no es opcional:** la cámara casi nunca ve la matrícula de
frente. Sin corregir la perspectiva, el OCR falla mucho más.

### 9.2 Normalización

El OCR devuelve texto sucio: `"ABC-1Z34"`, `"A8C 1234"`, `"AB C1234"`. La
normalización hace tres cosas:

1. Elimina todo lo que no sea letra o número.
2. Corrige las confusiones típicas **según la posición del carácter**: en el
   bloque de letras un `0` casi siempre es una `O`; en el bloque de dígitos una
   `O` casi siempre es un `0`. Aplicar el mismo mapa a toda la cadena rompe
   tantas lecturas como arregla.
3. Valida contra el patrón de matrícula (`^[A-Z]{3}[0-9]{4}$` para el formato
   Mercosur). Si no encaja, la lectura se **descarta**: un texto que no respeta
   el formato no es una matrícula.

El patrón es configurable en `vision/config.json` porque conviven formatos
anteriores al Mercosur.

### 9.3 Privacidad: la matrícula nunca se guarda

Una matrícula es un dato personal bajo la ley uruguaya 18.331. El diseño evita
almacenarla:

- El servicio de visión calcula un **HMAC-SHA256** de la matrícula normalizada,
  usando una clave secreta que vive solo en esa máquina.
- Lo único que viaja por la red y se guarda en la base es ese hash.
- El padrón de permisos se genera con la misma función y la misma clave, así que
  comparar permisos es comparar hashes.

**Por qué HMAC y no un SHA-256 pelado:** el espacio de matrículas posibles son
unos pocos millones de combinaciones. Con un hash sin clave, cualquiera que
obtenga la base puede probarlas todas en minutos y reconstruir qué auto estuvo
dónde y cuándo. La clave secreta es lo que vuelve inviable ese ataque.

Además, las lecturas se podan a los 30 días y el padrón nunca se expone al
navegador: la tabla no tiene ninguna política de Row Level Security, así que la
clave pública no la alcanza.

### 9.4 Los tres resultados posibles

| Resultado | Cuándo | Consecuencia |
|---|---|---|
| `autorizado` | Hash presente en el padrón con permiso vigente | Se muestra en el mapa como plaza correctamente ocupada |
| `no_autorizado` | Hash leído con confianza ≥ 0.80 y ausente del padrón | Se genera una **alerta para revisión humana** |
| `no_verificable` | El OCR no leyó nada, o con confianza < 0.80 | No se genera alerta |

La distinción entre `no_autorizado` y `no_verificable` es la decisión central de
esta sección. **No poder leer la matrícula no es lo mismo que leerla y que no
tenga permiso.** Confundirlas convertiría cada noche de lluvia en una tanda de
falsas infracciones.

### 9.5 Limitaciones que hay que asumir

**El permiso es de la persona, no del vehículo.** La tarjeta de estacionamiento
la emite la Intendencia a nombre del titular, y esa persona puede viajar en el
auto de un familiar, en un taxi o en un remise. Una matrícula ausente del padrón
**no prueba** que haya una infracción. Por eso el resultado `no_autorizado`
genera una alerta para que la revise una persona, y nunca una sanción
automática — lo cual es además coherente con lo declarado en la sección 1.

**No existe una API pública del padrón de la Intendencia.** Los permisos
vigentes no se pueden consultar programáticamente. La tabla
`permisos_discapacidad` es un padrón local que se carga a mano; para el
prototipo va con datos de prueba.

**El OCR falla seguido en condiciones reales:** de noche, con lluvia, con la
chapa sucia, en ángulo cerrado o con el vehículo lejos. Esto no es un defecto de
la implementación sino una característica del problema, y es exactamente lo que
absorbe el estado `no_verificable`.

---

## 10. Estructura del repositorio

```
ConnectaLab/
├── web/                          Sitio público y panel
│   ├── index.html                Mapa
│   ├── admin.html                Panel de administración
│   ├── css/estilos.css
│   ├── js/
│   │   ├── api.js                Capa de datos (demo o API real)
│   │   ├── mapa.js               Leaflet y coloreado de plazas
│   │   └── admin.js
│   └── datos/plazas-demo.json    Datos de fase 2, sin backend
├── api/                          Backend Node.js + Express
│   ├── src/
│   │   ├── index.js
│   │   ├── db.js                 Cliente de Supabase (clave de servicio)
│   │   ├── rutas/                zonas, plazas, eventos, matriculas
│   │   └── middleware/           autenticarDispositivo, autenticarUsuario
│   ├── scripts/generar-token.js  Tokens de dispositivo
│   ├── package.json
│   └── .env.example
├── vision/                       Servicio Python
│   ├── detectar.py               Bucle de cámara + YOLO
│   ├── ocr_matricula.py          Pipeline de OCR y hasheo
│   ├── regiones.json             Qué parte de la imagen es qué plaza
│   ├── config.example.json
│   └── requirements.txt
├── firmware/                     ESP32
│   ├── README.md                 Conexionado y calibración
│   └── sensor_plaza/
│       ├── sensor_plaza.ino
│       └── credenciales.example.h
├── db/
│   ├── esquema.sql
│   └── datos_prueba.sql
├── Tinkercad/                    Diagramas del circuito
├── DOCUMENTACION.md
├── README.md
└── .gitignore
```

Los tres archivos con secretos —  `api/.env`, `vision/config.json` y
`firmware/sensor_plaza/credenciales.h` — están en `.gitignore` y se crean
copiando su respectivo `.example`.

---

## 11. Plan de fases

Cada fase entrega algo demostrable por sí solo. Las fases 1 a 5 **no requieren
hardware**, lo que significa que un retraso en la compra o una falla del ESP32
no bloquea el avance del proyecto.

| # | Fase | Entregable | Depende de hardware | Estado |
|---|---|---|---|---|
| 1 | Repositorio | Estructura de carpetas, esquema SQL, README, `.gitignore` | No | Hecho |
| 2 | Mapa estático | Mapa de Montevideo con plazas de colores leídas de un JSON local | No | Pendiente |
| 3 | Base de datos y API | Tablas en Supabase, `GET /api/plazas`, el mapa consume la API | No | Pendiente |
| 4 | Autenticación y panel | Login con Supabase Auth, pantalla para cambiar estados a mano | No | Pendiente |
| 5 | Tiempo real | El mapa se repinta solo al cambiar un estado desde el panel | No | Pendiente |
| 6 | Hardware | ESP32 + HC-SR04 reportando una plaza física real | Sí | Pendiente |
| 7 | Visión | YOLO confirmando auto / no auto sobre regiones de interés | Sí | Pendiente |
| 8 | OCR de matrículas | Lectura de chapa, padrón de permisos, bandeja de alertas | Sí | Pendiente |
| 9 | Extras | Reservas, estadísticas de ocupación, histórico por franja horaria | No | Pendiente |

Al terminar la fase 5 el sistema ya es completamente demostrable de punta a
punta: se cambia un estado en el panel y el mapa de otro navegador se actualiza
al instante. La fase 6 solo reemplaza el clic manual por un sensor real.

La fase 8 depende de la 7: sin detección de vehículo no hay recorte sobre el que
buscar la chapa. Es la fase de mayor riesgo técnico y la última en la lista a
propósito — el proyecto es completo y defendible sin ella.

---

## 12. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El ESP32 no llega a tiempo o se daña | Alto | Fases 1-5 no lo requieren; el panel manual simula el sensor |
| El HC-SR04 da lecturas erráticas a la intemperie | Medio | Filtro de lecturas consecutivas; documentar la limitación; probar bajo techo |
| YOLO es demasiado lento en la computadora disponible | Medio | El sistema funciona sin visión; se puede bajar la resolución o usar el modelo `n` (nano) |
| Se supera el plan gratuito de Supabase | Bajo | Volumen de datos muy pequeño; los eventos se pueden podar a 90 días |
| Falsos positivos por personas u objetos | Medio | Umbral de lecturas consecutivas + confirmación por cámara |
| Pérdida de conexión WiFi del sensor | Medio | El estado pasa a `sin_datos` a los 30 minutos en lugar de mostrar datos viejos |
| El OCR lee mal una matrícula y marca a alguien como infractor | **Alto** | Umbral de confianza de 0.80; validación contra el formato; estado `no_verificable` separado de `no_autorizado`; revisión humana obligatoria |
| Filtración de la base con historial de matrículas | **Alto** | Solo se guarda el HMAC, nunca la matrícula; la clave vive fuera de la base; poda a 30 días; tabla sin política RLS |
| El padrón local de permisos queda desactualizado | Medio | Campo `vigente_hasta`; el resultado `no_autorizado` no sanciona, solo alerta |
| No conseguir pesos preentrenados para detectar chapas | Medio | El sistema funciona sin OCR: todo queda en `no_verificable`. Alternativa: etiquetar unas cientas de fotos propias |

---

## 13. Glosario

- **ALPR (Automatic License Plate Recognition):** nombre genérico del pipeline
  completo de lectura automática de matrículas.
- **Endpoint:** una dirección concreta de la API, por ejemplo `/api/plazas`. No
  es algo que se "envíe"; es el destino al que se le envía una petición.
- **HMAC:** hash calculado con una clave secreta. A diferencia de un hash común,
  no se puede recalcular sin conocer la clave, lo que impide probar todas las
  matrículas posibles hasta encontrar la que coincide.
- **OCR (Optical Character Recognition):** conversión de una imagen de texto en
  texto legible por la máquina.
- **ROI (región de interés):** rectángulo definido sobre la imagen de la cámara
  que corresponde a una plaza determinada.
- **Row Level Security (RLS):** mecanismo de PostgreSQL que define, fila por
  fila, quién puede leerla o escribirla.
- **Serialport:** comunicación por cable serie (USB). Aplica entre una
  computadora y un Arduino conectado físicamente, no entre servicios de red.
