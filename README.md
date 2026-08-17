# Parking Shopping Paysandú

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
tiempo real, el estado de cada plaza; y que verifique, mediante una cámara en
cada plaza reservada que lee la matrícula, si el vehículo que la ocupa está
autorizado.

**No es objetivo:** el cobro de tarifas, ni el control de la barrera de acceso.
El sistema informa y alerta; no decide quién entra.

### 1.1 Por qué el alcance privado

El proyecto empezó apuntando a la vía pública. Acotarlo a estacionamientos
privados no es una reducción de ambición: resuelve de raíz los cuatro problemas
más serios que tenía el diseño anterior.

| Problema en vía pública | Cómo lo resuelve el parking privado |
|---|---|
| El HC-SR04 se degrada con lluvia, suciedad y cambios de temperatura | Ambiente techado y estable, sensor montado en el cielorraso |
| El OCR falla de noche, en ángulo y con la chapa sucia | La matrícula se lee en la plaza reservada: vehículo detenido, iluminación artificial constante y tiempo de sobra para reintentar |
| No existe una API pública del padrón de permisos de la Intendencia | El parking administra su propio padrón de vehículos autorizados |
| Escala inabarcable: miles de plazas dispersas por la ciudad | Un parking son entre 20 y 200 plazas, con red WiFi propia |

Se suma un quinto punto, no menor: el operador del parking tiene una relación
contractual con sus usuarios, lo que da un fundamento legítimo para tratar datos
de matrícula. Vigilar la vía pública no lo tenía.

---

## 2. Arquitectura

### 2.1 Flujo de datos

```
Camara (solo en plazas reservadas) Sensor ultrasonico (uno por plaza)
      │                                      │
      │ el sensor avisa que llego un auto    │ detecta un objeto a menos de X cm
      ▼                                      ▼
Lector de matriculas (Java)           ESP32 ── WiFi ──┐
      │  recorta hasta la chapa,                      │
      │  la lee y la hashea                           │
      ▼                                               │
POST /api/lecturas ────────────────────────────────┐  │
                                                   ▼  ▼
                                    API REST (Node.js + Express)
                                    valida el token del dispositivo
                                                   │
                                                   ▼
                                    Base de datos (Supabase / PostgreSQL)
                                    · plazas     estado y autorizacion
                                    · eventos    historial de ocupacion
                                    · lecturas   matriculas leidas por plaza
                                                   │
                                                   ▼
                                    Supabase Realtime
                                                   │
                                                   ▼
                                    Sitio web — plano SVG del nivel
                                    repinta la plaza que cambio
```

Los dos flujos no son paralelos del todo: el de la izquierda **arranca por el de
la derecha**. Cuando el sensor reporta que una plaza reservada se ocupó, es eso
lo que despierta a la cámara. El lector se entera consultando la API, que es
quien sabe qué plazas quedaron pendientes de lectura.

### 2.2 La matrícula se lee en la plaza reservada

Es la decisión de diseño más importante del proyecto: **sólo las plazas de
discapacidad llevan cámara, y la entrada no lleva ninguna**.

Una cámara por cada plaza sería impracticable —un parking son entre 20 y 200
plazas—, pero las plazas reservadas son tres o cuatro. A esa escala el costo
deja de ser un obstáculo, y a cambio el sistema sabe directamente *qué auto está
en qué plaza reservada*, que es la única pregunta que el proyecto necesita
responder. No hay que deducirlo por conteo ni saber quién más está adentro.

**El sensor es el disparador.** La cámara no filma en continuo: se activa cuando
el sensor de esa plaza reporta que llegó un auto, y se apaga cuando reporta que
se fue. Eso evita procesar video sin parar y evita tener una cámara grabando una
plaza las veinticuatro horas.

**Un auto estacionado es un buen escenario de lectura**, mejor incluso que una
barrera. Está detenido, a distancia fija y conocida, bajo iluminación artificial
constante —un subsuelo no tiene noche ni contraluz— y, sobre todo, no hay apuro:
se pueden tomar decenas de fotos y quedarse con la lectura que más se repite. En
una barrera habría un segundo y medio para acertar.

**Qué se gana al no poner cámara en la entrada.** Además de una cámara menos, el
sistema deja de registrar a qué hora entró y salió cada usuario del parking. Ese
historial completo de movimientos era el dato más delicado que podía guardar, y
con este enfoque no existe: sólo se miran las tres o cuatro plazas reservadas.

**El costo del cambio es físico, no de software.** Hay que resolver el montaje
de cada cámara para que la chapa quede visible tanto si el auto entra de frente
como de culata, y aceptar que un vehículo mal estacionado puede tapar su propia
matrícula. Cuando eso pasa la lectura queda en `no_verificable`, que nunca
dispara una alerta por sí sola. Ver la sección 7.5.

**Limitación conocida:** el permiso de estacionamiento es de la persona, no del
vehículo. El titular puede llegar legítimamente en el auto de un familiar o en
un taxi, y esa lectura va a dar `no_autorizado`. Por eso el sistema nunca
sanciona: la alerta va siempre a revisión humana.

### 2.3 El sistema funciona sin cámara

La visión por computadora es una **capa de verificación**, no el camino crítico.
Los sensores ultrasónicos son la fuente del estado de ocupación; las cámaras
sólo agregan la identificación del vehículo, y sólo en las plazas reservadas.

Si el servicio de lectura está caído, el plano sigue mostrando plazas libres y
ocupadas con normalidad, y las plazas de discapacidad quedan en estado
`no_verificable`. Esta decisión evita que una falla en la parte más compleja del
proyecto tire abajo todo lo demás.

### 2.4 Cómo llega el cambio al navegador

El plano no consulta cada tantos segundos si algo cambió: se entera en el
momento. La pieza es **Supabase Realtime**, que replica los cambios de la tabla
`plazas` a los navegadores conectados por WebSocket.

```
Panel de administración ──┐
Sensor (ESP32, fase 6) ───┼──▶ API ──▶ UPDATE plazas ──┐
Editor SQL, migraciones ──┘                            │
                                                       ▼
                                          replicación (WAL)
                                                       │
                                                       ▼
                                           Supabase Realtime
                                                       │
                                    WebSocket           │
        Plano ◀────────────────────────────────────────┤
        Panel ◀────────────────────────────────────────┘
```

Lo importante es **qué se escucha: la tabla, no el endpoint**. Cualquier cosa
que modifique `plazas` dispara el aviso —el panel, un `update` a mano en el
editor SQL, el sensor de la fase 6, el lector de la fase 7— sin que haya que
tocar una línea del frontend. Si en cambio el aviso lo emitiera Express, un
cambio que no pasara por Express sería invisible, y la fase 6 obligaría a
reescribir esta capa.

Quedan dos consecuencias que el código tiene que resolver y no son obvias:

- **Hacen falta dos cosas, no una.** La tabla tiene que estar en la publicación
  `supabase_realtime` *y* el rol `anon` tiene que poder leer la fila: antes de
  mandar un cambio, Realtime se hace pasar por el suscriptor y comprueba si
  podría verlo con un `select`. Si falta cualquiera de las dos, el canal se
  conecta igual, el indicador se pone en verde y no llega nada nunca. Las dos
  están en `db/politicas.sql`.
- **Realtime no reenvía lo que uno se perdió.** No hay historial: los cambios
  ocurridos mientras el socket estuvo caído se pierden. Por eso, cada vez que el
  canal se reabre, el frontend vuelve a leer todo. Sin eso, un corte de red de
  un minuto deja el plano mostrando el estado del momento del corte, sin
  ninguna señal de que está mintiendo.

Las lecturas iniciales siguen yendo por la API en Express, que es la única con
la clave de servicio; el navegador usa la clave pública **sólo** para el canal
de tiempo real y para el inicio de sesión.

Se descartaron dos alternativas. Consultar la API cada pocos segundos
(*polling*) funciona, pero es una petición por nivel y por pestaña abierta y aun
así el cambio tarda lo que dure el intervalo. Un WebSocket propio en Express
obligaría a escribir a mano el servidor, la reconexión y el *heartbeat*, y
tendría el problema de fondo ya descrito: sólo se enteraría de lo que pasa por
Express.

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
| Lectura de matrículas | Java | Ya está desarrollado y probado: recorta la imagen hasta aislar la chapa, la lee y devuelve un valor de confianza |
| Cámaras | Una por plaza de discapacidad | Son tres o cuatro por parking; el sensor de la plaza les dice cuándo mirar |
| Firmware | ESP32 DevKit (WROOM-32) | WiFi integrado, pin de 5 V para el sensor, antena de PCB confiable |
| Sensor | HC-SR04 (ultrasónico) | Bajo costo y disponibilidad local; en ambiente techado su desempeño es bueno |

### 3.1 Decisiones descartadas y por qué

- **OpenStreetMap y Leaflet:** ya no aplican. Un parking privado no se ubica por
  latitud y longitud sino por nivel y posición en el plano. Las plazas se dibujan
  como rectángulos en coordenadas propias del plano. Esto elimina una dependencia
  externa, el servidor de teselas y la obligación de atribución de la licencia
  ODbL.
- **Java (Spring Boot) como backend:** duplicaría el rol de Node.js sin ganancia
  funcional. Distinto es Java como herramienta de lectura de matrículas, que sí
  se usa: ahí no compite con nada y el programa ya está hecho.
- **MySQL:** Supabase ya provee PostgreSQL. Usar ambos obligaría a sincronizar
  dos bases.
- **Cámara única en la entrada:** era el diseño anterior. Obligaba a deducir por
  conteo si una plaza reservada estaba mal ocupada, sin poder decir cuál, y a
  registrar las entradas y salidas de todos los usuarios para lograrlo. La
  cámara por plaza reservada responde la pregunta directamente y guarda menos
  datos. Ver la sección 2.2.
- **Detección de vehículos con YOLO:** ya no hace falta. El sensor de la plaza
  es el que avisa que llegó un auto; no hay que buscarlo dentro de la imagen.
  Esto elimina del proyecto una dependencia pesada y un modelo por entrenar.

---

## 4. Modelo de datos

### 4.1 Diseño

Tres separaciones sostienen el modelo:

- **Estado actual contra historial.** `plazas` guarda el estado presente: es lo
  que consulta el plano, tiene pocas filas y responde rápido. `eventos` guarda
  todo lo que pasó, nunca se actualiza ni se borra, y sirve para auditoría y
  estadísticas.
- **Ocupación contra identidad.** Los sensores escriben en `eventos`; las
  cámaras escriben en `lecturas`. Son dos flujos independientes sobre la misma
  plaza: uno dice si hay un auto, el otro dice cuál.
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

create type tipo_dispositivo as enum ('sensor', 'camara');

-- Todo dispositivo pertenece a una plaza: los sensores a todas, las camaras
-- solo a las reservadas. El tipo define que endpoint tiene permitido usar.
create table dispositivos (
  id                 serial primary key,
  estacionamiento_id integer not null references estacionamientos(id),
  plaza_id           integer not null references plazas(id),
  tipo               tipo_dispositivo not null,
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

create type resultado_lectura as enum (
  'autorizado', 'no_autorizado', 'no_verificable'
);

-- Una fila por intento de lectura de la camara de una plaza reservada. No
-- guarda la matricula ni la imagen: solo el HMAC. Se poda a los 30 dias.
create table lecturas (
  id             bigserial primary key,
  plaza_id       integer not null references plazas(id),
  matricula_hash text,          -- null cuando el OCR no pudo leerla
  confianza      real not null check (confianza between 0 and 1),
  resultado      resultado_lectura not null,
  vehiculo_id    integer references vehiculos_autorizados(id),
  creado_en      timestamptz not null default now()
);

-- Para revision HUMANA. El sistema no sanciona automaticamente.
-- Ahora la alerta apunta a una plaza concreta, no a un nivel entero.
create table alertas (
  id           bigserial primary key,
  plaza_id     integer not null references plazas(id),
  lectura_id   bigint references lecturas(id),
  motivo       text not null,
  revisada     boolean not null default false,
  revisada_por uuid,
  revisada_en  timestamptz,
  creado_en    timestamptz not null default now()
);
```

Los usuarios los administra Supabase Auth en su propio esquema; no se crea una
tabla `usuarios` propia.

### 4.3 Cómo se resuelve la autorización de una plaza

`estado` y `autorizacion` avanzan por separado. El sensor mueve el primero; la
cámara, el segundo. Para una plaza de discapacidad la secuencia completa es:

| Qué pasó | `estado` | `autorizacion` |
|---|---|---|
| El sensor reporta que llegó un auto | `ocupado` | `pendiente` |
| La cámara leyó y el hash está en el padrón con permiso vigente | `ocupado` | `autorizado` |
| La cámara leyó con confianza suficiente y el hash no está en el padrón | `ocupado` | `no_autorizado` |
| La cámara no pudo leer, o leyó con confianza baja | `ocupado` | `no_verificable` |
| El sensor reporta que se fue | `libre` | `no_aplica` |

En las plazas que no son de discapacidad `autorizacion` vale siempre
`no_aplica`: no hay cámara y no hay nada que verificar.

### 4.4 Reglas de negocio

- El cliente nunca modifica `plazas` directamente. El backend escribe el evento
  y después actualiza el estado.
- Si una plaza no reporta ningún evento durante 30 minutos pasa a `sin_datos`.
  Es preferible mostrar "sin información" a mostrar información vieja como si
  fuera actual.
- Cuando una plaza de discapacidad pasa a `ocupado`, su autorización queda en
  `pendiente` y se encola una lectura para su cámara.
- Si a los 5 minutos no llegó ninguna lectura válida, la autorización pasa a
  `no_verificable`. Una plaza no puede quedarse en `pendiente` para siempre.
- Cuando una plaza se libera, su autorización vuelve a `no_aplica`. La
  autorización describe al vehículo que está ahí, no a la plaza.
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
| `GET` | `/api/lecturas/pendientes` | Plazas reservadas que acaban de ocuparse y todavía no tienen lectura |
| `POST` | `/api/lecturas` | La cámara de una plaza reporta una lectura de matrícula |

Cuerpo de `/api/eventos`:

```json
{
  "plaza_id": 12,
  "estado": "ocupado",
  "fuente": "sensor",
  "confianza": 0.8
}
```

Cuerpo de `/api/lecturas` — obsérvese que **no lleva la matrícula ni la
imagen**, sólo el hash:

```json
{
  "plaza_id": 1,
  "matricula_hash": "9f86d081884c7d65...",
  "confianza": 0.93
}
```

Si el OCR no pudo leer nada se envía `"matricula_hash": null` y `"confianza": 0`.
La lectura se registra igual: saber que se intentó y no se pudo es justamente lo
que distingue `no_verificable` de `no_autorizado`. El backend resuelve el campo
`resultado` comparando el hash contra el padrón; el lector no conoce el padrón y
no decide nada.

El token va en el header `Authorization: Bearer <token>`. El backend verifica
que el dispositivo tenga permitido reportar sobre esa plaza o estacionamiento.

### Administración (requieren sesión de usuario)

| Método | Ruta | Descripción |
|---|---|---|
| `PATCH` | `/api/plazas/:id` | Cambio manual de estado |
| `GET` | `/api/eventos?plaza_id=&desde=&hasta=` | Historial de ocupación |
| `GET` | `/api/lecturas?plaza_id=` | Historial de lecturas de una plaza reservada |
| `GET` | `/api/alertas` | Bandeja de alertas pendientes de revisión |
| `PATCH` | `/api/alertas/:id` | Marcar una alerta como revisada |
| `POST` | `/api/vehiculos` | Alta de un vehículo autorizado en el padrón |
| `DELETE` | `/api/vehiculos/:id` | Baja de un vehículo del padrón |
| `POST` | `/api/niveles` | Alta de un piso con sus plazas generadas |
| `DELETE` | `/api/niveles/:id` | Baja de un piso; 409 si tiene historial |

**No hay endpoint de tiempo real.** Todo lo que el navegador *lee* pasa por esta
API; los avisos de cambio llegan por el canal de Supabase Realtime, directo
desde la base y sin intervención de Express. El porqué está en la sección 2.4.

---

## 6. Seguridad y datos personales

Una matrícula es un dato personal bajo la ley uruguaya 18.331. El diseño evita
almacenarla:

- El lector de matrículas calcula un **HMAC-SHA256** de la matrícula
  normalizada, con una clave secreta que vive sólo en esa máquina.
- Lo único que viaja por la red y se guarda en la base es ese hash.
- El padrón de vehículos autorizados se genera con la misma función y la misma
  clave, así que comparar permisos es comparar hashes.

**Por qué HMAC y no un SHA-256 pelado:** el espacio de matrículas posibles son
unos pocos millones de combinaciones. Con un hash sin clave, cualquiera que
obtenga la base puede probarlas todas en minutos y averiguar qué matrícula
estacionó en qué plaza y a qué hora. La clave secreta es lo que vuelve inviable
ese ataque.

### 6.1 La imagen nunca se guarda

Una cámara apuntando de forma permanente a una plaza reservada capta algo más
sensible que un paragolpes: capta a personas bajando del auto, transfiriéndose a
una silla de ruedas. El diseño lo trata como tal:

- **La cámara se dispara por evento del sensor**, no filma en continuo. Fuera de
  los minutos posteriores a que un auto estacione, no hay nada mirando.
- **La imagen se procesa en memoria y se descarta.** No se guarda ni se
  transmite: lo único que sale de esa máquina es un hash y un número de
  confianza.
- **No hay cámara en la entrada**, así que el sistema no sabe —ni puede
  reconstruir— a qué hora entró y salió cada usuario del parking.

### 6.2 Resto de las medidas

- **La clave de servicio de Supabase vive sólo en el backend.** Nunca en el
  firmware ni en el JavaScript del navegador.
- **El frontend usa la clave pública con Row Level Security activado.** Las
  políticas permiten leer `plazas`, `niveles` y `estacionamientos`; `eventos`,
  `dispositivos`, `lecturas`, `vehiculos_autorizados` y `alertas` tienen RLS
  activado y **ninguna** política, así que la clave pública no las alcanza
  jamás. Está en `db/politicas.sql`. Habilitar RLS sin política no es lo mismo
  que dejar RLS apagado: apagado, los permisos por defecto de Supabase le dan a
  `anon` acceso de lectura y escritura a todo el esquema `public`, y la clave
  pública está —por diseño— a la vista en el JavaScript del navegador.
- **Cada dispositivo tiene su propio token**, guardado hasheado. Si un ESP32 es
  manipulado físicamente se revoca ese token sin afectar al resto.
- **Los endpoints de dispositivo tienen límite de tasa.** Un sensor con falla no
  debe poder llenar la base.
- **Las lecturas se podan a los 30 días.** No hay razón para conservar el
  historial de matrículas más allá de eso.
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

### 7.5 La cámara de la plaza reservada

Sólo las plazas de discapacidad la llevan. Como son tres o cuatro por parking,
no hace falta una computadora por cámara: alcanza con cámaras IP sobre la red
WiFi del parking y **un único proceso que las atiende a todas**.

Lo que hay que resolver en el montaje:

- **Dónde apuntar.** El auto puede estacionar de frente o de culata. En Uruguay
  lleva chapa adelante y atrás, así que siempre hay una mirando hacia afuera,
  pero conviene montar la cámara al frente de la plaza, a la altura de la chapa
  —cerca de 50 cm del piso— y no en el cielorraso: desde arriba la matrícula se
  ve en escorzo.
- **Iluminación.** Un subsuelo tiene poca luz, pero constante. La ventaja es que
  se calibra una vez y no cambia con la hora ni con el clima. Si hace falta, un
  foco fijo sobre la plaza resuelve el problema de una vez y para siempre.
- **Oclusión.** Un auto mal estacionado puede tapar su propia matrícula, y una
  persona parada delante también. No es un caso a evitar: es un caso a manejar,
  y se maneja dejando la lectura en `no_verificable`.

La cámara no necesita token propio si el proceso que la atiende ya lo tiene: el
dispositivo que se autentica contra la API es el proceso, y reporta indicando a
qué plaza corresponde cada lectura.

---

## 8. Servicio de lectura de matrículas

Proceso Java independiente, corriendo en una computadora del parking, que
atiende las cámaras de todas las plazas reservadas.

Su ciclo es simple porque el sensor le hizo la parte difícil:

1. Le pregunta a la API qué plazas reservadas acaban de ocuparse y todavía no
   tienen lectura (`GET /api/lecturas/pendientes`, cada pocos segundos; con tres
   o cuatro plazas, consultar por *polling* no justifica nada más elaborado).
2. Toma varias fotos de la cámara de esa plaza a lo largo de un minuto.
3. Sobre cada foto corre el lector: recorta la imagen hasta aislar la chapa, la
   lee y devuelve el texto con un valor de confianza.
4. Se queda con **la lectura que más se repite** entre todas las fotos. Que un
   auto estacionado no se mueva es lo que permite este lujo, y es la mejor
   defensa contra una lectura equivocada: un error de OCR rara vez se repite
   igual muchas veces seguidas.
5. Calcula el HMAC de esa matrícula y hace `POST /api/lecturas`.

Nótese que el servicio **no consulta el padrón ni decide si el vehículo está
autorizado**. Sólo lee y hashea. Quien compara contra el padrón es el backend,
que es el único que tiene por qué conocerlo.

---

## 9. Lectura de matrículas por OCR

Esta parte **ya está desarrollada y probada** en un programa Java propio, contra
fotos fijas. Lo que sigue describe cómo funciona y cómo se integra.

### 9.1 El pipeline

| # | Etapa | Qué hace |
|---|---|---|
| 1 | Recorte progresivo | El programa va recortando la foto hasta aislar la matrícula |
| 2 | Lectura | Sobre ese recorte lee el texto y devuelve un valor de confianza |
| 3 | Normalización | Se limpia el texto y se lo valida contra el formato de matrícula |
| 4 | Hasheo | Se calcula el HMAC-SHA256 de la matrícula ya normalizada |

**No hay etapa de detección del vehículo.** El diseño anterior empezaba con YOLO
buscando el auto dentro de la escena, para después buscar la chapa dentro del
auto. Con una cámara dedicada a una sola plaza y un sensor que avisa cuándo hay
alguien en ella, esa etapa no aporta: ya se sabe que hay un auto y ya se sabe
dónde. Se ahorra un modelo, una dependencia pesada y bastante tiempo de cómputo.

**La confianza no es un adorno.** Es el número que separa "no pude leer" de "leí
y no tiene permiso", y de esa distinción depende que una lectura fallida no se
convierta en una falsa infracción. Ver 9.3.

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
| `autorizado` | Hash presente en el padrón con permiso vigente | La plaza queda en verde: el vehículo puede estar ahí |
| `no_autorizado` | Hash leído con confianza ≥ 0,80 y ausente del padrón | Se genera una alerta para revisión humana |
| `no_verificable` | El OCR no leyó nada, o con confianza < 0,80 | No se lo puede asociar a ningún permiso, y **no** se genera alerta |

**No poder leer la matrícula no es lo mismo que leerla y que no tenga permiso.**
Confundirlas convertiría cada lectura fallida en una falsa infracción. Por eso
`no_verificable` existe como estado separado y nunca dispara una alerta por sí
mismo.

### 9.4 Qué gatilla una alerta

Una sola cosa: **una plaza de discapacidad cuya lectura dio `no_autorizado`**.
La alerta nombra la plaza, porque la cámara pertenece a esa plaza y a ninguna
otra. No hay deducción por conteo ni ambigüedad sobre cuál es.

Una lectura `no_verificable` **nunca** genera una alerta. No poder leer la
matrícula no es lo mismo que leerla y que no tenga permiso; confundirlas
convertiría cada foto borrosa en una acusación.

La alerta va a una **bandeja de revisión humana** y el sistema no sanciona. La
razón está en 2.2: el permiso es de la persona, no del vehículo, así que un
`no_autorizado` legítimo es perfectamente posible y sólo una persona puede
resolverlo.

---

## 10. Estructura del repositorio

```
ConnectaLab/
├── web/                          Sitio público y panel
│   ├── index.html                Plano del nivel
│   ├── admin.html                Panel de administración
│   ├── css/estilos.css
│   ├── js/
│   │   ├── supabase.js           Cliente de Supabase con la clave pública
│   │   ├── api.js                Capa de datos: lectura y canal de tiempo real
│   │   ├── plano.js              Plano SVG y selector de niveles
│   │   └── admin.js
│   └── datos/plazas-demo.json    Datos de fase 2, sin backend
├── api/                          Backend Node.js + Express
│   ├── src/
│   │   ├── plano/generar.js      Geometria de un nivel a partir de la cantidad de plazas
│   │   ├── index.js
│   │   ├── db.js                 Cliente de Supabase (clave de servicio)
│   │   ├── rutas/                niveles, plazas, eventos, lecturas, vehiculos
│   │   └── middleware/           autenticarDispositivo, autenticarUsuario
│   ├── scripts/generar-token.js  Tokens de dispositivo
│   ├── package.json
│   └── .env.example
├── vision/                       Lector de matrículas (Java)
│   ├── src/                      Recorte, lectura, normalización y hasheo
│   ├── config.example.json       Cámaras, URL de la API y clave del HMAC
│   └── README.md                 Cómo compilarlo y calibrar las cámaras
├── firmware/                     ESP32
│   ├── README.md                 Conexionado y calibración
│   └── sensor_plaza/
│       ├── sensor_plaza.ino
│       └── credenciales.example.h
├── db/
│   ├── esquema.sql               Tablas y tipos
│   ├── funciones.sql             registrar_evento(): evento + estado en una operación
│   ├── politicas.sql             RLS y publicación de tiempo real
│   └── datos_prueba.sql
├── Tinkercad/                    Diagramas del circuito
├── README.md
└── .gitignore
```

Los tres archivos con secretos —`api/.env`, `vision/config.json` y
`firmware/sensor_plaza/credenciales.h`— están en `.gitignore` y se crean
copiando su respectivo `.example`.

Al día de hoy tienen archivos reales `web/`, `api/`, `db/` y el firmware del
sensor; `vision/` y el resto del árbol son la estructura a la que apunta el
proyecto y se va llenando fase por fase.

---

## 11. Puesta en marcha

### Base de datos

Crear un proyecto en [supabase.com](https://supabase.com) y correr, desde el
editor SQL y **en este orden**, los cuatro archivos de `db/`:

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `esquema.sql` | Tablas y tipos |
| 2 | `funciones.sql` | `registrar_evento()`, que usa el `PATCH` de la API |
| 3 | `datos_prueba.sql` | Un estacionamiento con tres niveles y sus plazas |
| 4 | `politicas.sql` | RLS y publicación de tiempo real |

El orden importa: `funciones.sql` usa los tipos que crea `esquema.sql`, y
`politicas.sql` cierra el acceso público a las tablas sensibles. Correr los tres
primeros y saltear el cuarto deja la base abierta a cualquiera que tenga la
clave pública, que está a la vista en el navegador. `politicas.sql` se puede
volver a correr cuantas veces haga falta sin romper nada.

Para comprobar que quedó bien:

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

Todas las tablas tienen que aparecer con `rowsecurity` en `true`, y la segunda
consulta tiene que devolver `plazas`.

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
npx serve -l 5173 web 
```

Tiene que servirse por HTTP, no abrirse como archivo: con `file://` el navegador
bloquea el `fetch` del JSON y además rechaza los módulos ES, con lo cual no
carga ni una línea de JavaScript. La fuente de datos se controla con la
constante `MODO` en `web/js/api.js`.

Los tres archivos de `web/js/` son módulos ES y se cargan encadenados desde un
único `<script type="module">` por página: `plano.js` (o `admin.js`) importa
`api.js`, que importa `supabase.js`. Por eso el HTML no lleva una etiqueta por
archivo.

### Lector de matrículas (opcional)

Se compila y se corre según se explica en `vision/README.md`. Antes de
arrancarlo hay que copiar `config.example.json` a `config.json` y completar la
URL de la API, el token del dispositivo, la dirección de cada cámara y la clave
del HMAC. Esa clave tiene que ser **la misma** con la que se generó el padrón de
vehículos autorizados, o ningún hash va a coincidir.

### Firmware (opcional)

Ver [firmware/README.md](firmware/README.md).

---

## 12. Plan de fases

Cada fase entrega algo demostrable por sí solo. Las fases 1 a 5 **no requieren
hardware**: un retraso en la compra o una falla del ESP32 no bloquea el avance.

| # | Fase | Entregable | Hardware | Estado |
|---|---|---|---|---|
| 1 | Repositorio | Estructura, esquema SQL, documentación | No | Hecho |
| 2 | Plano estático | Plano SVG con selector de niveles y plazas de colores desde un JSON local | No | Hecho |
| 3 | Base de datos y API | Tablas en Supabase, `GET /api/plazas`, el plano consume la API | No | Hecho |
| 4 | Autenticación y panel | Login con Supabase Auth, cambio manual de estados | No | Hecho |
| 5 | Tiempo real | El plano se repinta solo al cambiar un estado | No | Hecho |
| 6 | Hardware | ESP32 + HC-SR04 reportando una plaza real | Sí | Pendiente |
| 7 | Cámara en la plaza | La cámara se dispara con el sensor y el lector Java devuelve el hash | Sí | Pendiente |
| 8 | Padrón y alertas | Padrón de autorizados, resolución de la autorización y bandeja de revisión | Sí | Pendiente |

Fuera de esta tabla, el lector de matrículas —lo que en el plan original era la
parte más riesgosa— **ya está desarrollado y probado sobre fotos fijas**. La
fase 7 no es escribirlo: es montarlo, calibrarlo y conectarlo.

El criterio de aceptación de la fase 3 conviene tenerlo escrito: se cambia la
constante `MODO` de `demo` a `real` y **la página tiene que verse idéntica**. Si
eso pasa, la separación entre la capa de datos y el plano era correcta.

Con la fase 5 terminada el sistema **ya es demostrable de punta a punta**: se
cambia un estado en el panel y el plano de otra computadora se actualiza al
instante, sin recargar. La fase 6 sólo reemplaza el clic manual por un sensor
real: como lo que se escucha es la tabla y no la API (sección 2.4), el frontend
no se entera de la diferencia y no hay que tocarlo.

El criterio de aceptación de la fase 5 tiene dos partes, y la segunda es la que
cuesta: (a) un `update` a `plazas` hecho desde **fuera** del panel —por ejemplo
desde el editor SQL— repinta el plano igual; y (b) después de cortar la red,
cambiar un estado y volver a conectar, el plano queda mostrando el valor
correcto. Lo primero prueba que se escucha la tabla; lo segundo, que la
relectura al reconectar funciona. Sin (b) el sistema anda en la demostración y
miente en producción.

La fase 8 depende de la 7. El riesgo que queda en ambas ya no es de software
sino de instalación: dónde se monta la cámara y si la chapa queda visible.

---

## 13. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El ESP32 no llega a tiempo o se daña | Alto | Fases 1-5 no lo requieren; el panel manual simula el sensor. Comprar una placa de repuesto |
| El OCR lee mal y se marca a alguien como infractor | Alto | Umbral de 0,80; validación de formato; se exige la lectura repetida en varias fotos; `no_verificable` separado de `no_autorizado`; revisión humana obligatoria |
| Filtración de la base con el historial de lecturas | Alto | Sólo se guarda el HMAC; la clave vive fuera de la base; poda a 30 días; RLS **activado** y sin ninguna política en `lecturas`, `vehiculos_autorizados`, `alertas`, `eventos` y `dispositivos`, de modo que la clave pública no devuelve una sola fila (`db/politicas.sql`) |
| La cámara no consigue un ángulo con la chapa visible | Medio | Montaje al frente de la plaza y a la altura de la matrícula; probar con el auto de frente y de culata; sin lectura no hay alerta, queda en `no_verificable` |
| La cámara capta a personas bajando del auto | Medio | Se dispara sólo por evento del sensor; la imagen se procesa en memoria y no se guarda nunca |
| Una cámara por plaza reservada encarece la instalación | Bajo | Son tres o cuatro por parking, no una por plaza; cámaras IP sobre la red existente y un solo proceso que las atiende |
| Un sensor por plaza no escala en costo | Medio | Multiplexar 8-12 sensores por ESP32; para el prototipo, una plaza real y el resto simulado |
| Se corta el canal de tiempo real y el plano muestra datos viejos sin avisar | Medio | Indicador de conexión visible en el encabezado; al reabrirse el canal el frontend vuelve a leer todo, porque Realtime no reenvía lo perdido |

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
