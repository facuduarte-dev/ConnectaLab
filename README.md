# ConectaLAB

Plataforma de gestión inteligente de plazas para **estacionamientos privados**.
Muestra en tiempo real, sobre el plano del parking, qué plazas están libres,
ocupadas o reservadas, a partir de sensores ultrasónicos y visión por
computadora.

---

## 1. Problema y objetivo

La sobrepoblación automovilística de Montevideo genera un problema concreto
dentro de los estacionamientos privados —edificios, centros comerciales,
oficinas, sanatorios—: los usuarios recorren niveles enteros buscando una plaza
libre, y las plazas reservadas para personas con discapacidad son ocupadas por
vehículos sin permiso, sin forma práctica de detectarlo.

**Objetivo:** una plataforma web que muestre en el plano de cada nivel, en
tiempo real, el estado de cada plaza; y que verifique, mediante lectura de
matrícula en la entrada, si los vehículos que ocupan plazas reservadas están
autorizados.

**No es objetivo:** el cobro de tarifas, ni el control de la barrera de acceso.
El sistema informa y alerta; no decide quién entra.

### 1.1 Por qué el alcance privado

El proyecto empezó apuntando a la vía pública. Acotarlo a estacionamientos
privados no es una reducción de ambición: resuelve de raíz los cuatro problemas
más serios que tenía el diseño anterior.

| Problema en vía pública | Cómo lo resuelve el parking privado |
|---|---|
| El HC-SR04 se degrada con lluvia, suciedad y cambios de temperatura | Ambiente techado y estable, sensor montado en el cielorraso |
| El OCR falla de noche, en ángulo y con la chapa sucia | La matrícula se lee en la entrada: vehículo detenido, de frente, con iluminación controlada |
| No existe una API pública del padrón de permisos de la Intendencia | El parking administra su propio padrón de vehículos autorizados |
| Escala inabarcable: miles de plazas dispersas por la ciudad | Un parking son entre 20 y 200 plazas, con red WiFi propia |

Se suma un quinto punto, no menor: el operador del parking tiene una relación
contractual con sus usuarios, lo que da un fundamento legítimo para tratar datos
de matrícula. Vigilar la vía pública no lo tenía.

---

## 2. Arquitectura

### 2.1 Flujo de datos

```
Camara de entrada                  Sensor ultrasonico (uno por plaza)
      │                                      │
      │ vehiculo detenido en la barrera      │ detecta un objeto a menos de X cm
      ▼                                      ▼
YOLO + OCR (Python)                   ESP32 ── WiFi ──┐
      │  lee la matricula                             │
      │  y la hashea                                  │
      ▼                                               │
POST /api/accesos ─────────────────────────────────┐  │
                                                   ▼  ▼
                                    API REST (Node.js + Express)
                                    valida el token del dispositivo
                                                   │
                                                   ▼
                                    Base de datos (Supabase / PostgreSQL)
                                    · accesos    quien esta adentro
                                    · eventos    historial de ocupacion
                                    · plazas     estado actual
                                                   │
                                                   ▼
                                    Supabase Realtime
                                                   │
                                                   ▼
                                    Sitio web — plano SVG del nivel
                                    repinta la plaza que cambio
```

### 2.2 La matrícula se lee en la entrada, no en cada plaza

Es la decisión de diseño más importante del nuevo enfoque.

En la entrada, el vehículo está **detenido frente a la barrera, de frente, a
distancia corta y con iluminación controlada**. Son exactamente las condiciones
en las que el OCR funciona bien. Dentro del parking, en cambio, los autos quedan
en ángulo, a contraluz y a distancia variable: leer la chapa ahí es el escenario
difícil.

Entonces el sistema no intenta saber *qué auto está en qué plaza*. Sabe dos
cosas por separado:

1. **Quién está adentro**, por la cámara de entrada y salida.
2. **Qué plazas están ocupadas**, por los sensores.

Y cruza ambas con una regla de conteo:

> Si la cantidad de plazas de discapacidad ocupadas supera la cantidad de
> vehículos con permiso de discapacidad actualmente dentro del parking,
> hay al menos una plaza ocupada indebidamente.

Esto elimina la necesidad de una cámara por nivel o por plaza, que era la parte
más cara e imprecisa del diseño anterior.

**Limitación conocida:** la regla detecta que *hay* una ocupación indebida, pero
no *cuál* es. Si un vehículo con permiso entra y estaciona en una plaza común
mientras otro sin permiso toma la de discapacidad, el conteo da correcto y la
infracción pasa desapercibida. Para resolverlo haría falta una cámara por nivel,
que queda como mejora futura y está fuera del alcance de este proyecto.

### 2.3 El sistema funciona sin cámara

La visión por computadora es una **capa de verificación**, no el camino crítico.
Los sensores ultrasónicos son la fuente del estado de ocupación; la cámara sólo
agrega la identificación de vehículos autorizados.

Si el servicio de visión está caído, el plano sigue mostrando plazas libres y
ocupadas con normalidad, y las plazas de discapacidad quedan en estado
`no_verificable`. Esta decisión evita que una falla en la parte más compleja del
proyecto tire abajo todo lo demás.

---

## 3. Stack tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| Frontend | HTML, CSS, JavaScript | Sin framework: el proyecto no lo necesita y suma complejidad |
| Plano | SVG generado en JS | El plano de un parking son rectángulos sobre una grilla: no hace falta librería |
| Backend | Node.js + Express | Mismo lenguaje que el frontend, arranque rápido |
| Base de datos | Supabase (PostgreSQL) | Base de datos, autenticación y tiempo real en un solo servicio, con plan gratuito |
| Autenticación | Supabase Auth | Resuelve el inicio de sesión sin implementar manejo de contraseñas |
| Tiempo real | Supabase Realtime | Notifica cambios de fila al navegador sin escribir WebSockets a mano |
| Visión | Python + ultralytics (YOLO) | YOLO no existe como librería de JavaScript ni corre en el ESP32 |
| OCR | EasyOCR | Mejor desempeño en matrículas que Tesseract, pensado para texto de documentos |
| Firmware | ESP32 DevKit (WROOM-32) | WiFi integrado, pin de 5 V para el sensor, antena de PCB confiable |
| Sensor | HC-SR04 (ultrasónico) | Bajo costo y disponibilidad local; en ambiente techado su desempeño es bueno |

### 3.1 Decisiones descartadas y por qué

- **OpenStreetMap y Leaflet:** ya no aplican. Un parking privado no se ubica por
  latitud y longitud sino por nivel y posición en el plano. Las plazas se dibujan
  como rectángulos en coordenadas propias del plano. Esto elimina una dependencia
  externa, el servidor de teselas y la obligación de atribución de la licencia
  ODbL.
- **Java (Spring Boot):** duplicaría el rol de Node.js sin ganancia funcional.
- **MySQL:** Supabase ya provee PostgreSQL. Usar ambos obligaría a sincronizar
  dos bases.
- **Una cámara por plaza o por nivel:** reemplazada por la cámara única de
  entrada más la regla de conteo de la sección 2.2.

---

## 4. Modelo de datos

### 4.1 Diseño

Tres separaciones sostienen el modelo:

- **Estado actual contra historial.** `plazas` guarda el estado presente: es lo
  que consulta el plano, tiene pocas filas y responde rápido. `eventos` guarda
  todo lo que pasó, nunca se actualiza ni se borra, y sirve para auditoría y
  estadísticas.
- **Ocupación contra identidad.** Los sensores escriben en `eventos`; la cámara
  de entrada escribe en `accesos`. Son dos flujos independientes que sólo se
  cruzan al evaluar la regla de conteo.
- **Estado contra autorización.** Una plaza de discapacidad ocupada por un
  vehículo sin permiso sigue estando *ocupada*. Son dos preguntas distintas
  —¿hay un auto? y ¿tiene permiso?— y mezclarlas en un solo campo obligaría a
  duplicar cada estado por cada nivel de autorización.

### 4.2 Esquema

```sql
create table estacionamientos (
  id        serial primary key,
  nombre    text not null,
  direccion text,
  activo    boolean not null default true
);

-- Un nivel es una planta del parking. Sus dimensiones definen el sistema de
-- coordenadas del plano: las plazas se posicionan dentro de esa grilla.
create table niveles (
  id                 serial primary key,
  estacionamiento_id integer not null references estacionamientos(id),
  nombre             text not null,      -- 'Subsuelo 1', 'Planta baja'
  orden              smallint not null,
  ancho_plano        integer not null,
  alto_plano         integer not null,
  unique (estacionamiento_id, orden)
);

create type tipo_plaza   as enum ('normal', 'discapacidad', 'carga', 'moto');
create type estado_plaza as enum ('libre', 'ocupado', 'reservado', 'sin_datos');

create type autorizacion_plaza as enum (
  'no_aplica', 'pendiente', 'autorizado', 'no_autorizado', 'no_verificable'
);

-- x, y, ancho y alto son coordenadas del PLANO, no geograficas.
create table plazas (
  id             serial primary key,
  nivel_id       integer not null references niveles(id),
  codigo         text not null,
  x              integer not null,
  y              integer not null,
  ancho          integer not null default 40,
  alto           integer not null default 80,
  tipo           tipo_plaza         not null default 'normal',
  estado         estado_plaza       not null default 'sin_datos',
  autorizacion   autorizacion_plaza not null default 'no_aplica',
  actualizado_en timestamptz        not null default now(),
  unique (nivel_id, codigo)
);

create type fuente_evento as enum ('sensor', 'camara', 'manual');

create table eventos (
  id        bigserial primary key,
  plaza_id  integer not null references plazas(id),
  estado    estado_plaza  not null,
  fuente    fuente_evento not null,
  confianza real not null default 1.0 check (confianza between 0 and 1),
  creado_en timestamptz not null default now()
);

create table dispositivos (
  id                 serial primary key,
  estacionamiento_id integer not null references estacionamientos(id),
  plaza_id           integer references plazas(id),  -- null en la camara de entrada
  token_hash         text not null,
  descripcion        text,
  activo             boolean not null default true,
  ultimo_ping        timestamptz
);
```

**Padrón propio del parking.** Reemplaza al padrón de la Intendencia, que no era
consultable. Acá el operador administra sus propios vehículos autorizados:
abonados, empleados, visitas y permisos de discapacidad.

```sql
create type tipo_permiso as enum ('abonado', 'discapacidad', 'empleado', 'visita');

-- No guarda la matricula: guarda su HMAC-SHA256. Ver seccion 6.
create table vehiculos_autorizados (
  id                 serial primary key,
  estacionamiento_id integer not null references estacionamientos(id),
  matricula_hash     text not null,
  tipo_permiso       tipo_permiso not null,
  referencia         text,          -- 'Unidad 402'. Nunca la matricula ni el nombre.
  vigente_desde      date not null default current_date,
  vigente_hasta      date,
  activo             boolean not null default true,
  unique (estacionamiento_id, matricula_hash, tipo_permiso)
);

create type sentido_acceso as enum ('entrada', 'salida');

-- Registro de la camara de entrada. Se poda a los 30 dias.
create table accesos (
  id                 bigserial primary key,
  estacionamiento_id integer not null references estacionamientos(id),
  matricula_hash     text,          -- null cuando el OCR no pudo leerla
  sentido            sentido_acceso not null,
  confianza          real not null check (confianza between 0 and 1),
  vehiculo_id        integer references vehiculos_autorizados(id),
  creado_en          timestamptz not null default now()
);

-- Para revision HUMANA. El sistema no sanciona automaticamente.
create table alertas (
  id           bigserial primary key,
  nivel_id     integer references niveles(id),
  motivo       text not null,
  revisada     boolean not null default false,
  revisada_por uuid,
  revisada_en  timestamptz,
  creado_en    timestamptz not null default now()
);
```

Los usuarios los administra Supabase Auth en su propio esquema; no se crea una
tabla `usuarios` propia.

### 4.3 Quién está adentro

La consulta que sostiene la regla de conteo: un vehículo está dentro si su
último movimiento registrado fue una entrada.

```sql
create view vehiculos_dentro as
select distinct on (a.matricula_hash)
       a.estacionamiento_id, a.matricula_hash, a.vehiculo_id, a.creado_en
  from accesos a
 where a.matricula_hash is not null
 order by a.matricula_hash, a.creado_en desc;
-- filtrar despues por sentido = 'entrada'
```

### 4.4 Reglas de negocio

- El cliente nunca modifica `plazas` directamente. El backend escribe el evento
  y después actualiza el estado.
- Si una plaza no reporta ningún evento durante 30 minutos pasa a `sin_datos`.
  Es preferible mostrar "sin información" a mostrar información vieja como si
  fuera actual.
- Cada vez que cambia la ocupación de una plaza de discapacidad, se reevalúa la
  regla de conteo del nivel.
- Un vehículo cuyo permiso venció deja de contar como autorizado desde la fecha
  de vencimiento, aunque siga figurando en la tabla.

---

## 5. API

Todos los endpoints bajo `/api`.

### Públicos (lectura)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/niveles` | Niveles con dimensiones del plano y conteo de libres |
| `GET` | `/api/plazas?nivel_id=` | Plazas de un nivel, con posición y estado |
| `GET` | `/api/plazas/:id` | Detalle de una plaza |

### Dispositivos (requieren token de dispositivo)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/eventos` | El ESP32 reporta ocupación de una plaza |
| `POST` | `/api/accesos` | La cámara de entrada reporta un movimiento |

Cuerpo de `/api/eventos`:

```json
{
  "plaza_id": 12,
  "estado": "ocupado",
  "fuente": "sensor",
  "confianza": 0.8
}
```

Cuerpo de `/api/accesos` — obsérvese que **no lleva la matrícula**, sólo su
hash:

```json
{
  "matricula_hash": "9f86d081884c7d65...",
  "sentido": "entrada",
  "confianza": 0.93
}
```

Si el OCR no pudo leer nada se envía `"matricula_hash": null`. El acceso queda
registrado igual, porque el vehículo entró de todos modos; simplemente no se lo
puede asociar a un permiso.

El token va en el header `Authorization: Bearer <token>`. El backend verifica
que el dispositivo tenga permitido reportar sobre esa plaza o estacionamiento.

### Administración (requieren sesión de usuario)

| Método | Ruta | Descripción |
|---|---|---|
| `PATCH` | `/api/plazas/:id` | Cambio manual de estado |
| `GET` | `/api/eventos?plaza_id=&desde=&hasta=` | Historial de ocupación |
| `GET` | `/api/alertas` | Bandeja de alertas pendientes de revisión |
| `POST` | `/api/vehiculos` | Alta de un vehículo autorizado en el padrón |
| `DELETE` | `/api/vehiculos/:id` | Baja de un vehículo del padrón |

---

## 6. Seguridad y datos personales

Una matrícula es un dato personal bajo la ley uruguaya 18.331. El diseño evita
almacenarla:

- El servicio de visión calcula un **HMAC-SHA256** de la matrícula normalizada,
  con una clave secreta que vive sólo en esa máquina.
- Lo único que viaja por la red y se guarda en la base es ese hash.
- El padrón de vehículos autorizados se genera con la misma función y la misma
  clave, así que comparar permisos es comparar hashes.

**Por qué HMAC y no un SHA-256 pelado:** el espacio de matrículas posibles son
unos pocos millones de combinaciones. Con un hash sin clave, cualquiera que
obtenga la base puede probarlas todas en minutos y reconstruir a qué hora entró
y salió cada vehículo. La clave secreta es lo que vuelve inviable ese ataque.

Además:

- **La clave de servicio de Supabase vive sólo en el backend.** Nunca en el
  firmware ni en el JavaScript del navegador.
- **El frontend usa la clave pública con Row Level Security activado.** Las
  políticas permiten leer `plazas` y `niveles`; `accesos` y
  `vehiculos_autorizados` no tienen ninguna política, así que la clave pública
  no las alcanza jamás.
- **Cada dispositivo tiene su propio token**, guardado hasheado. Si un ESP32 es
  manipulado físicamente se revoca ese token sin afectar al resto.
- **Los endpoints de dispositivo tienen límite de tasa.** Un sensor con falla no
  debe poder llenar la base.
- **Los accesos se podan a los 30 días.** No hay razón para conservar el
  historial de entradas y salidas más allá de eso.
- **Las credenciales van en variables de entorno**, nunca versionadas.

---

## 7. Hardware

### 7.1 Circuito

ESP32 DevKit (WROOM-32) + HC-SR04:

| HC-SR04 | ESP32 |
|---|---|
| VCC | 5V |
| TRIG | GPIO 5 |
| ECHO | GPIO 18, **mediante divisor de tensión** |
| GND | GND |

**Importante:** el pin ECHO del HC-SR04 entrega 5 V y las entradas del ESP32
toleran 3.3 V. Hay que intercalar un divisor (1 kΩ + 2 kΩ) o la placa se degrada
con el tiempo.

```
ECHO ──[ 1kΩ ]──┬── GPIO 18
                │
             [ 2kΩ ]
                │
               GND
```

### 7.2 Montaje

En un parking techado el montaje correcto es **el sensor en el cielorraso,
apuntando hacia abajo**, centrado sobre la plaza y a unos 2,2 a 2,5 m del piso.
Con la plaza vacía el sensor mide la distancia al piso; con un auto debajo, la
distancia al techo del vehículo. El umbral se calibra entre ambos valores.

Es un escenario mucho más favorable que la vía pública: sin lluvia, sin
suciedad, sin variación térmica relevante y con distancias fijas y conocidas.

### 7.3 Lógica del firmware

1. Medir distancia cada 500 ms.
2. Considerar la plaza ocupada tras 3 lecturas consecutivas por debajo del
   umbral. El filtro evita que una persona caminando dispare el cambio.
3. Considerar la plaza libre tras 5 lecturas consecutivas por encima.
4. Emitir el POST **sólo cuando el estado cambia**, no en cada lectura.
5. Enviar un ping cada 10 minutos aunque no haya cambios, para que el backend
   sepa que el sensor sigue vivo.

### 7.4 Escalar a un parking completo

Un sensor por plaza con un ESP32 cada uno no escala en costo: 60 plazas serían
60 placas. Las salidas habituales, en orden de conveniencia:

1. **Un ESP32 cada 8 a 12 sensores**, multiplexando los pines. Es lo más simple
   y lo que se recomienda para este proyecto.
2. Bus RS-485 con nodos económicos por fila de plazas.
3. Sensores magnéticos embebidos en el piso, que es lo que usan las
   instalaciones comerciales.

Para el prototipo alcanza con **una plaza instrumentada de verdad** y el resto
simulado desde el panel. Demostrar el ciclo completo sobre una plaza real prueba
exactamente lo mismo que sesenta.

---

## 8. Servicio de visión

Proceso Python independiente, corriendo en una computadora junto a la entrada.

- Modelo: YOLO preentrenado en COCO, que ya reconoce `car`, `truck`, `bus` y
  `motorcycle` sin entrenar nada propio.
- Entrada: cámara de celular usada como cámara IP, o webcam USB, apuntada a la
  zona de la barrera.
- Dispara cuando detecta un vehículo detenido en la zona de lectura.
- Salida: `POST /api/accesos` con el hash de la matrícula y la confianza.

El sentido —entrada o salida— se determina por la cámara que lo reporta: una
para cada carril. Con un solo carril, se infiere del último movimiento de ese
mismo vehículo.

---

## 9. Lectura de matrículas por OCR

### 9.1 El pipeline

Cuatro etapas encadenadas; cada una recibe el recorte que produjo la anterior:

| # | Etapa | Qué hace |
|---|---|---|
| 1 | Detección del vehículo | YOLO encuentra el auto detenido en la zona de lectura |
| 2 | Localización de la chapa | Un segundo modelo busca la matrícula **dentro del recorte del auto** |
| 3 | Rectificación | Corrige perspectiva, pasa a escala de grises y binariza |
| 4 | OCR y normalización | EasyOCR lee el texto y se lo valida contra el formato de matrícula |

**Por qué la etapa 2 trabaja sobre el recorte y no sobre la imagen completa:**
buscar una chapa en toda la escena produce muchos más falsos positivos
—carteles, señalización, chapas de otros vehículos—. Acotar la búsqueda al área
donde ya se sabe que hay un auto mejora la precisión de forma notable.

**Por qué la etapa 3 sigue siendo necesaria** aunque el vehículo esté de frente:
la cámara nunca queda perfectamente alineada con la chapa, y una corrección de
perspectiva leve mejora el reconocimiento igual.

### 9.2 Normalización

El OCR devuelve texto sucio: `"ABC-1Z34"`, `"A8C 1234"`. La normalización:

1. Elimina todo lo que no sea letra o número.
2. Corrige las confusiones típicas **según la posición del carácter**: en el
   bloque de letras un `0` casi siempre es una `O`; en el bloque de dígitos una
   `O` casi siempre es un `0`. Aplicar el mismo mapa a toda la cadena rompe
   tantas lecturas como arregla.
3. Valida contra el patrón (`^[A-Z]{3}[0-9]{4}$` para el formato Mercosur). Si
   no encaja, la lectura se **descarta**: un texto que no respeta el formato no
   es una matrícula.

El patrón es configurable porque conviven formatos anteriores al Mercosur.

### 9.3 Los tres resultados

| Resultado | Cuándo | Consecuencia |
|---|---|---|
| `autorizado` | Hash presente en el padrón con permiso vigente | El vehículo cuenta como autorizado mientras esté adentro |
| `no_autorizado` | Hash leído con confianza ≥ 0,80 y ausente del padrón | Cuenta como vehículo común |
| `no_verificable` | El OCR no leyó nada, o con confianza < 0,80 | No se lo puede asociar a ningún permiso |

**No poder leer la matrícula no es lo mismo que leerla y que no tenga permiso.**
Confundirlas convertiría cada lectura fallida en una falsa infracción. Por eso
`no_verificable` existe como estado separado y nunca dispara una alerta por sí
mismo.

### 9.4 Qué gatilla una alerta

Una alerta se genera cuando, en un nivel, la cantidad de plazas de discapacidad
ocupadas supera la cantidad de vehículos con permiso de discapacidad
actualmente dentro del parking.

La alerta va a una **bandeja de revisión humana**. El sistema no sanciona: el
permiso de estacionamiento es de la persona y no del vehículo, así que el
titular puede legítimamente llegar en el auto de un familiar o en un taxi. Y si
hay lecturas `no_verificable` en la última hora, la alerta se marca como de baja
confianza, porque el conteo pudo haber fallado.

---

## 10. Estructura del repositorio

```
ConnectaLab/
├── web/                          Sitio público y panel
│   ├── index.html                Plano del nivel
│   ├── admin.html                Panel de administración
│   ├── css/estilos.css
│   ├── js/
│   │   ├── api.js                Capa de datos (demo o API real)
│   │   ├── plano.js              Dibujo del plano en SVG
│   │   └── admin.js
│   └── datos/plazas-demo.json    Datos de fase 2, sin backend
├── api/                          Backend Node.js + Express
│   ├── src/
│   │   ├── index.js
│   │   ├── db.js                 Cliente de Supabase (clave de servicio)
│   │   ├── rutas/                niveles, plazas, eventos, accesos, vehiculos
│   │   └── middleware/           autenticarDispositivo, autenticarUsuario
│   ├── scripts/generar-token.js  Tokens de dispositivo
│   ├── package.json
│   └── .env.example
├── vision/                       Servicio Python
│   ├── entrada.py                Bucle de cámara de la barrera
│   ├── ocr_matricula.py          Pipeline de OCR y hasheo
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
├── README.md
└── .gitignore
```

Los tres archivos con secretos —`api/.env`, `vision/config.json` y
`firmware/sensor_plaza/credenciales.h`— están en `.gitignore` y se crean
copiando su respectivo `.example`.

---

## 11. Puesta en marcha

### Base de datos

Crear un proyecto en [supabase.com](https://supabase.com) y correr, desde el
editor SQL, primero `db/esquema.sql` y después `db/datos_prueba.sql`.

### Backend

```bash
cd api
npm install
cp .env.example .env
npm run dev
```

Completar `.env` con las credenciales de Supabase. La API queda en
`http://localhost:3000`.

### Sitio web

```bash
npx serve web
```

Tiene que servirse por HTTP, no abrirse como archivo: con `file://` el navegador
bloquea el `fetch` del JSON. La fuente de datos se controla con la constante
`MODO` en `web/js/api.js`.

### Servicio de visión (opcional)

```bash
cd vision
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cp config.example.json config.json
python entrada.py
```

### Firmware (opcional)

Ver [firmware/README.md](firmware/README.md).

---

## 12. Plan de fases

Cada fase entrega algo demostrable por sí solo. Las fases 1 a 5 **no requieren
hardware**: un retraso en la compra o una falla del ESP32 no bloquea el avance.

| # | Fase | Entregable | Hardware | Estado |
|---|---|---|---|---|
| 1 | Repositorio | Estructura, esquema SQL, documentación | No | Hecho |
| 2 | Plano estático | Plano SVG de un nivel con plazas de colores desde un JSON local | No | En curso |
| 3 | Base de datos y API | Tablas en Supabase, `GET /api/plazas`, el plano consume la API | No | Pendiente |
| 4 | Autenticación y panel | Login con Supabase Auth, cambio manual de estados | No | Pendiente |
| 5 | Tiempo real | El plano se repinta solo al cambiar un estado | No | Pendiente |
| 6 | Hardware | ESP32 + HC-SR04 reportando una plaza real | Sí | Pendiente |
| 7 | Cámara de entrada | YOLO detectando vehículos en la barrera | Sí | Pendiente |
| 8 | OCR y padrón | Lectura de matrícula, padrón de autorizados, regla de conteo | Sí | Pendiente |

Al terminar la fase 5 el sistema es demostrable de punta a punta: se cambia un
estado en el panel y el plano de otra computadora se actualiza al instante. La
fase 6 sólo reemplaza el clic manual por un sensor real.

La fase 8 depende de la 7 y es la de mayor riesgo técnico. Está última a
propósito: el proyecto es completo y defendible sin ella.

---

## 13. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El ESP32 no llega a tiempo o se daña | Alto | Fases 1-5 no lo requieren; el panel manual simula el sensor. Comprar una placa de repuesto |
| El OCR lee mal y se marca a alguien como infractor | Alto | Umbral de 0,80; validación de formato; `no_verificable` separado de `no_autorizado`; revisión humana obligatoria |
| Filtración de la base con el historial de accesos | Alto | Sólo se guarda el HMAC; la clave vive fuera de la base; poda a 30 días; tablas sin política RLS |
| No conseguir pesos preentrenados para detectar chapas | Medio | El sistema funciona sin OCR: todo queda en `no_verificable` |
| YOLO demasiado lento en la computadora disponible | Medio | Sólo procesa cuando hay un vehículo detenido, no en continuo; modelo `n` (nano) |
| La regla de conteo no identifica cuál plaza está mal ocupada | Medio | Documentado como limitación conocida; requiere cámara por nivel, fuera de alcance |
| Un sensor por plaza no escala en costo | Medio | Multiplexar 8-12 sensores por ESP32; para el prototipo, una plaza real y el resto simulado |

---

## 14. Glosario

- **ALPR:** *Automatic License Plate Recognition*, el pipeline completo de
  lectura automática de matrículas.
- **Endpoint:** una dirección concreta de la API, por ejemplo `/api/plazas`. No
  es algo que se "envíe": es el destino al que se le envía una petición.
- **HMAC:** hash calculado con una clave secreta. A diferencia de un hash común,
  no se puede recalcular sin conocer la clave, lo que impide probar todas las
  matrículas posibles hasta encontrar la que coincide.
- **OCR:** *Optical Character Recognition*, conversión de una imagen de texto en
  texto legible por la máquina.
- **Row Level Security (RLS):** mecanismo de PostgreSQL que define, fila por
  fila, quién puede leerla o escribirla.
- **Strapping pin:** pin cuyo estado durante el arranque configura el modo de
  inicio del microcontrolador. En el ESP32 conviene no usarlos para sensores.
