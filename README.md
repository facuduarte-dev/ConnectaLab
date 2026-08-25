# ParkEx

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
| No existe una API pública del padrón de permisos de la Intendencia | No hace falta consultarlo: el distintivo de discapacidad viene impreso en la propia chapa (4.3) |
| Escala inabarcable: miles de plazas dispersas por la ciudad | Un parking son entre 20 y 200 plazas, concentradas en un edificio con una computadora de operacion |

Se suma un quinto punto, no menor: el operador del parking tiene una relación
contractual con sus usuarios, lo que da un fundamento legítimo para tratar datos
de matrícula. Vigilar la vía pública no lo tenía.

---

## 2. Arquitectura

### 2.1 Flujo de datos

```
        LA PLAZA                              LA COMPUTADORA DEL PARKING
        (sin red, sin credenciales)           (la unica con red y credenciales)

  HC-SR04 ──┐                            ┌────────────────────────────────┐
  uno por   │ distancia                  │                                │
  plaza     ▼                            │   Puente serie (Node.js)       │
        Arduino Uno ─── USB ────────────▶│   traduce cada linea en una    │
        decide el cambio de estado       │   POST /api/eventos            │
        y lo emite por el puerto serie   │              │                 │
                                         │              │                 │
  webcam USB ────────── USB ────────────▶│   Lector de matriculas (Java)  │
  solo en plazas                         │   recorta hasta la chapa,      │
  reservadas                             │   la lee y la hashea           │
                                         │   POST /api/lecturas           │
                                         └──────────────┬─────────────────┘
                                                        ▼
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

Los dos flujos no son paralelos del todo: el de la cámara **arranca por el del
sensor**. Cuando el sensor reporta que una plaza reservada se ocupó, es eso lo
que despierta a la cámara. El lector se entera consultando la API, que es quien
sabe qué plazas quedaron pendientes de lectura.

### 2.1.1 Ningún dispositivo de la plaza habla con la red

Es la segunda decisión estructural del proyecto, y conviene entenderla antes de
seguir: **lo que está montado en la plaza no tiene WiFi, ni token, ni sabe que
existe una API**. El Arduino mide una distancia y escribe una línea de texto por
el puerto serie. Nada más.

Toda la conectividad está concentrada en una sola máquina —**el puente**, o
*gateway*— que traduce esas líneas a peticiones HTTP. Es el patrón habitual en
instalaciones reales: sensores baratos y mudos, y un concentrador que carga con
la red y las credenciales.

Tres consecuencias, y ninguna es menor:

- **El dispositivo físico no guarda secretos.** Una placa atornillada al
  cielorraso de un subsuelo es accesible: se desatornilla y se lleva. Si el
  token del dispositivo viviera ahí, quien se la lleva puede reportar eventos
  falsos hasta que alguien revoque el token. Acá el token vive en el `.env` del
  puente, que está bajo llave con el resto de la infraestructura. Del Arduino no
  se saca nada porque no tiene nada.
- **El sensor se prueba sin red.** Se abre el monitor serie y se ve exactamente
  lo que el dispositivo está diciendo. No hay que distinguir entre un sensor que
  mide mal y un WiFi que no conecta: son dos etapas separadas, cada una con su
  propia forma de fallar.
- **Se paga con un cable.** Es el costo real y está en la sección 13: el Arduino
  tiene que llegar por USB hasta la computadora, y eso limita la distancia. No es
  gratis y no se disimula.

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
dispara una alerta por sí sola. Ver la sección 7.6.

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
Puente serie (fase 6) ────┼──▶ API ──▶ UPDATE plazas ──┐
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
editor SQL, el puente de la fase 6, el lector de la fase 7— sin que haya que
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
| Cámaras | Webcam USB, una por plaza de discapacidad | Son tres o cuatro por parking y cuelgan de la misma máquina que corre el lector: no hay red de por medio ni una cámara que administrar |
| Microcontrolador | Arduino Uno | Corre la lógica del sensor. Trabaja a 5 V igual que el HC-SR04, se graba por USB y no necesita red: la conectividad la pone el puente |
| Puente serie | Node.js + `serialport` | Traduce cada línea del Arduino en un `POST` a la API. Mismo lenguaje y mismo repositorio que el backend |
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
- **Placas con WiFi integrado (ESP32, ESP32-CAM):** era el diseño anterior, y
  la idea de que cada sensor hablara solo con la API es atractiva. Se descartó
  por tres motivos, en orden de peso. Primero, **la credencial queda expuesta**:
  el token y la contraseña del WiFi tendrían que vivir en una placa accesible en
  el cielorraso de un subsuelo. Segundo, **multiplica los puntos de falla por
  plaza**: cada nodo suma su propia antena, su propia reconexión y su propia
  fuente, y cuando una plaza deja de reportar hay que ir físicamente hasta ella
  para saber por qué. Tercero, **cuesta más depurar**: un sensor que mide mal y
  un nodo que no asocia al WiFi se ven igual desde la API —silencio—, mientras
  que por el puerto serie se ve exactamente qué está midiendo. La contrapartida
  honesta es el cable USB hasta el puente, y está anotada en la sección 13.
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

create type tipo_dispositivo as enum ('sensor', 'camara', 'gateway');

-- Esta tabla es dos cosas a la vez, y conviene no confundirlas: el INVENTARIO
-- de lo que hay instalado, y las CREDENCIALES de lo que se autentica.
--
-- El Arduino de una plaza figura aca como 'sensor' porque interesa saber que
-- esa plaza esta instrumentada, pero su token_hash va en null: no habla con la
-- red ni guarda secretos (seccion 2.1.1). Lo mismo la webcam. Quien se
-- autentica contra la API es el puente, de tipo 'gateway', que cubre todas las
-- plazas del estacionamiento y por eso lleva plaza_id en null.
create table dispositivos (
  id                 serial primary key,
  estacionamiento_id integer not null references estacionamientos(id),
  plaza_id           integer references plazas(id),   -- null cuando es gateway
  tipo               tipo_dispositivo not null,
  token_hash         text,            -- null = no se autentica solo
  descripcion        text,
  activo             boolean not null default true,
  ultimo_ping        timestamptz,
  constraint plaza_segun_tipo check (
    (tipo =  'gateway' and plaza_id is null) or
    (tipo <> 'gateway' and plaza_id is not null)
  )
);
```

**No hay tabla de vehículos autorizados.** La verificación no compara la
matrícula contra ningún padrón: mira si la chapa lleva el distintivo de
discapacidad (4.3). El hash que guarda `lecturas` es el identificador de una
lectura dentro del historial de su plaza, no una clave de búsqueda contra nada.

```sql
create type resultado_lectura as enum (
  'autorizado', 'no_autorizado', 'no_verificable'
);

-- Una fila por intento de lectura de la camara de una plaza reservada. No
-- guarda la matricula ni la imagen: solo el HMAC. Se poda a los 30 dias.
--
-- Tampoco guarda el distintivo en una columna aparte: en una plaza de
-- discapacidad 'autorizado' YA significa que la chapa lo llevaba, y
-- 'no_autorizado' que no. Una columna extra seria el mismo dato escrito dos
-- veces, y dos lugares donde puede terminar en desacuerdo consigo mismo.
create table lecturas (
  id             bigserial primary key,
  plaza_id       integer not null references plazas(id),
  matricula_hash text,          -- null cuando el OCR no pudo leerla
  confianza      real not null check (confianza between 0 and 1),
  resultado      resultado_lectura not null,
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
| La cámara leyó con confianza suficiente y la chapa lleva el distintivo | `ocupado` | `autorizado` |
| La cámara leyó con confianza suficiente y la chapa no lo lleva | `ocupado` | `no_autorizado` |
| La cámara no pudo leer, o leyó con confianza baja | `ocupado` | `no_verificable` |
| El sensor reporta que se fue | `libre` | `no_aplica` |

En las plazas que no son de discapacidad `autorizacion` vale siempre
`no_aplica`: no hay cámara y no hay nada que verificar.

**Qué se mira, y por qué es la chapa y no un padrón.** El distintivo de
discapacidad está impreso en la matrícula: el bloque de letras termina en `DI`
—`IDI 1483`, `ADI 4021`—. Un padrón propio del parking sería una copia parcial y
siempre desactualizada de algo que la chapa ya dice sola, y por el mismo motivo
que 2.2 da para desconfiar de él: el permiso es de la persona, y el parking no
tiene cómo enterarse de una alta o una baja que otorga la Intendencia.

**Dónde se mira.** En el lector, sobre la matrícula ya normalizada y **antes**
de hashearla. Es el último punto del recorrido en el que la chapa todavía existe
como texto: de ahí en adelante sólo viaja el HMAC, y de un hash no se recupera
la matrícula (sección 6). El lector reporta el hecho que observó
—`distintivo_di: true` o `false`— y el backend decide qué significa. Esa
separación es deliberada: si mañana cambia qué amerita una alerta, se toca un
archivo del backend y no hay que reinstalar el programa Java de la computadora
del parking.

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
| `POST` | `/api/eventos` | El puente reporta la ocupación de una plaza |
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
  "confianza": 0.93,
  "distintivo_di": true
}
```

Si el OCR no pudo leer nada se envía `"matricula_hash": null`, `"confianza": 0`
y `"distintivo_di": null`. La lectura se registra igual: saber que se intentó y
no se pudo es justamente lo que distingue `no_verificable` de `no_autorizado`.
El distintivo va en `null` y no en `false` porque sin matrícula no hay
distintivo que mirar, y un `false` ahí sería *afirmar* que la chapa no lo
llevaba.

`distintivo_di` es lo único del cuerpo que el backend no podría averiguar por su
cuenta: de la computadora del parking sale el HMAC, y de un hash no se recupera
el texto de la chapa. Por eso el reparto es ése —el lector reporta el **hecho**
que observó y el backend resuelve `resultado`, que es la **política**—. Si
`matricula_hash` viene con valor y `distintivo_di` no es un booleano, la API
responde `400` en vez de asumir `false`: un campo que falta no puede convertirse
en una acusación.

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
| `POST` | `/api/niveles` | Alta de un piso con sus plazas generadas |
| `DELETE` | `/api/niveles/:id` | Baja de un piso; 409 si tiene historial |

**Todo cambio de estado pasa por `registrar_evento()`.** Tanto el `POST` de
dispositivo como el `PATCH` manual del panel llaman a esa función de la base, y
no escriben `plazas` por su cuenta. Es lo que garantiza la regla de la sección
4.4 —primero el evento, después el estado— y que las dos escrituras ocurran en
una sola transacción. La autorización es la excepción y va aparte: no es un
evento de ocupación, así que no entra en `eventos`.

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
- Ese hash **no se compara contra nada**: identifica una lectura dentro del
  historial de su plaza y nada más. Lo que decide la autorización —si la chapa
  lleva el distintivo— se mira antes de hashear, y de esa máquina sale sólo el
  resultado de esa mirada: un booleano, nunca la matrícula.

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
  puente, ni en el sketch del Arduino, ni en el JavaScript del navegador.
- **El frontend usa la clave pública con Row Level Security activado.** Las
  políticas permiten leer `plazas`, `niveles` y `estacionamientos`; `eventos`,
  `dispositivos`, `lecturas` y `alertas` tienen RLS
  activado y **ninguna** política, así que la clave pública no las alcanza
  jamás. Está en `db/politicas.sql`. Habilitar RLS sin política no es lo mismo
  que dejar RLS apagado: apagado, los permisos por defecto de Supabase le dan a
  `anon` acceso de lectura y escritura a todo el esquema `public`, y la clave
  pública está —por diseño— a la vista en el JavaScript del navegador.
- **El hardware de la plaza no guarda credenciales.** El Arduino del cielorraso
  no tiene token ni contraseña de red: escribe distancias por un cable
  (sección 2.1.1). Quien se lo lleve no se lleva nada más que un
  microcontrolador. El único dispositivo con token es el puente, y corre en la
  computadora del parking, bajo el mismo control que el resto de la
  infraestructura.
- **Cada dispositivo que sí tiene token lo tiene propio**, guardado hasheado. Si
  uno se compromete se revoca ese token sin afectar al resto.
- **Los endpoints de dispositivo tienen límite de tasa.** Un sensor con falla no
  debe poder llenar la base.
- **Las lecturas se podan a los 30 días.** No hay razón para conservar el
  historial de matrículas más allá de eso.
- **Las credenciales van en variables de entorno**, nunca versionadas.

---

## 7. Hardware

### 7.1 Circuito

Arduino Uno + HC-SR04:

| HC-SR04 | Arduino Uno |
|---|---|
| VCC | 5V |
| TRIG | pin 9 |
| ECHO | pin 8 |
| GND | GND |

**No lleva divisor de tensión, y eso es deliberado.** El HC-SR04 entrega 5 V en
ECHO y las entradas del Uno trabajan a 5 V: se conectan directo. El diseño
anterior, sobre ESP32, obligaba a intercalar un divisor de 1 kΩ + 2 kΩ en esa
línea porque sus entradas toleran 3,3 V y se degradan con 5 V. Al quedarse en un
microcontrolador de 5 V ese componente desaparece del circuito, y con él una
fuente de error de armado.

Dos LEDs de señalización local, opcionales pero muy útiles al calibrar:

| LED | Arduino Uno | Significa |
|---|---|---|
| Rojo | pin 2, con resistencia de 220 a 330 Ω a GND | Plaza ocupada |
| Verde | pin 3, con resistencia de 220 a 330 Ω a GND | Plaza libre |

Permiten ver el estado sin mirar la pantalla: parado debajo del sensor se sabe
si el umbral quedó bien calibrado.

### 7.2 Montaje

En un parking techado el montaje correcto es **el sensor en el cielorraso,
apuntando hacia abajo**, centrado sobre la plaza y a unos 2,2 a 2,5 m del piso.
Con la plaza vacía el sensor mide la distancia al piso; con un auto debajo, la
distancia al techo del vehículo. El umbral se calibra entre ambos valores.

Es un escenario mucho más favorable que la vía pública: sin lluvia, sin
suciedad, sin variación térmica relevante y con distancias fijas y conocidas.

**La restricción nueva es el cable.** El Arduino tiene que llegar por USB hasta
la computadora que corre el puente, y el USB 2.0 está especificado hasta 5 m.
Con un cable activo (con repetidor) se llega a 15 o 20 m, y con un extensor USB
sobre cable de red, a 50 m. Para el prototipo —una sola plaza instrumentada—
alcanza sobrado. Para un parking entero es la limitación real del diseño y está
anotada como tal en la sección 13.

### 7.3 Lógica del firmware

1. Medir distancia cada 500 ms.
2. Considerar la plaza ocupada tras 3 lecturas consecutivas por debajo del
   umbral. El filtro evita que una persona caminando dispare el cambio.
3. Considerar la plaza libre tras 5 lecturas consecutivas por encima.
4. Emitir una línea por el puerto serie **sólo cuando el estado cambia**, no en
   cada lectura.
5. Emitir un `PING` cada 10 minutos aunque no haya cambios, para que el backend
   sepa que el sensor sigue vivo. Sin eso, a los 30 minutos sin novedades la
   plaza pasaría a `sin_datos` (sección 4.4).
6. Emitir también un `PING` **al arrancar**, apenas haya una medición válida.
   Un `LISTO` solo le dice al puente que la placa se reinició, no en qué estado
   quedó la plaza: sin este punto, un reinicio del Arduino dejaría el plano
   mostrando el estado anterior hasta diez minutos después.

**Una lectura inválida no es "libre".** Cuando no vuelve el eco, o la distancia
cae fuera del rango útil del sensor, la medición se descarta y no mueve ningún
contador. Tratar el silencio como "no hay nadie" haría que una falla del sensor
se viera igual que una plaza vacía, que es exactamente el error que el `PING` y
el estado `sin_datos` existen para evitar.

**El Arduino decide el estado; no lo reporta.** La lógica del cambio —umbral,
filtro, histéresis— vive en el microcontrolador, que es quien tiene la medición
cruda. El puente no interpreta distancias: recibe una decisión ya tomada y la
traduce a HTTP. Si el criterio de ocupación cambia, se toca el sketch y nada
más.

### 7.4 El protocolo serie

Es la frontera entre el hardware y el software, así que conviene que sea
explícita. Todas las líneas terminan en salto de línea, a **115200 baudios**,
con el formato `TIPO;clave=valor;clave=valor`:

| Línea | Cuándo se emite | Qué hace el puente |
|---|---|---|
| `LISTO;plaza=1` | Al arrancar el Arduino | Lo registra en el log. No reporta nada a la API |
| `EVENTO;plaza=1;estado=ocupado;distancia=87` | Al confirmarse un cambio de estado | `POST /api/eventos` |
| `EVENTO;plaza=1;estado=libre;distancia=231` | Ídem | `POST /api/eventos` |
| `PING;plaza=1;estado=libre;distancia=229` | Cada 10 minutos, y una vez al arrancar apenas hay una medición válida | `POST /api/eventos` con el estado actual |
| `DIST;plaza=1;distancia=143` | Sólo con `DEPURAR_DISTANCIA` activo | Lo ignora. Es para calibrar a ojo |

Tres decisiones que parecen menores y no lo son:

- **El prefijo va primero.** El puente descarta de un vistazo lo que no entiende,
  y el día que haga falta un tipo de línea nuevo, los viejos no se rompen.
- **Es clave=valor y no posicional.** Agregar un campo —la temperatura, el número
  de sensor— no corre a los demás de lugar ni obliga a tocar el puente.
- **Se lee a ojo.** La misma línea que consume el puente se lee sin traducir en
  el monitor serie del IDE. Calibrar y producir usan exactamente la misma
  salida, así que no hay un "modo depuración" que se comporte distinto del real.

El separador es `;` y no `,` porque las distancias podrían llegar a escribirse
con decimales.

### 7.5 El puente serie

Un proceso Node.js corriendo en la computadora del parking. Es el único
componente del lado del hardware que conoce la API, y su trabajo es corto:

1. Abre el puerto serie del Arduino y lo lee línea por línea.
2. Descarta lo que no entiende. Un microcontrolador que se reinicia escupe
   basura en el puerto, y eso no puede convertirse en una petición.
3. Traduce cada `EVENTO` y cada `PING` en un `POST /api/eventos`, con el token
   del dispositivo en el header.
4. Si la API no responde, **reintenta con espera creciente**. Un corte de red no
   puede perder un cambio de estado.
5. Si el puerto serie se cae —alguien desenchufó el USB— lo reabre solo cada
   pocos segundos, y lo deja registrado.

Lo que el puente **no** hace: no interpreta distancias, no decide estados, no
resuelve autorizaciones y no habla con la base de datos. Traduce y reintenta.

**Por qué en Node y no en Java.** El backend ya es Node y vive en el mismo
repositorio, así que el puente comparte lenguaje, dependencias y forma de
configurarse con el resto del servidor. La librería `serialport` es la estándar
del ecosistema. Java tenía un argumento a favor —el lector de matrículas ya está
escrito en Java y corre en la misma máquina—, pero son dos procesos
independientes que hablan con la API y no entre sí, así que compartir lenguaje
entre ellos no aporta nada.

### 7.6 La cámara de la plaza reservada

Sólo las plazas de discapacidad la llevan, y es una **webcam USB** conectada a
la misma computadora que corre el puente y el lector. Como son tres o cuatro por
parking, un solo proceso las atiende a todas.

Que la cámara cuelgue de esa máquina y no de la red es coherente con el resto
del diseño: si ya hay una computadora en el circuito, agregarle un dispositivo
con su propia radio, su propia dirección IP y su propia contraseña sólo suma
cosas que se pueden romper. Y la imagen nunca sale de esa máquina, que es
justamente lo que exige la sección 6.1.

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
- **El alcance del USB**, otra vez. Vale lo mismo que en 7.2, con el agravante
  de que la cámara va al frente de la plaza y no en el cielorraso.

La cámara no necesita token propio: el dispositivo que se autentica contra la
API es el proceso lector, y reporta indicando a qué plaza corresponde cada
lectura.

### 7.7 Escalar a un parking completo

Un sensor por plaza con un microcontrolador cada uno no escala en costo: 60
plazas serían 60 placas. Las salidas habituales, en orden de conveniencia:

1. **Un Arduino cada varios sensores.** Cada HC-SR04 usa dos pines, y el TRIG se
   puede compartir entre todos disparando de a uno por vez. Un Uno maneja
   cómodamente 5 o 6 sensores; un Mega, más de 20. El protocolo no cambia: la
   línea ya lleva el campo `plaza=`.
2. **Varios Arduinos por puente.** El proceso Node abre un puerto serie por
   placa. Es la forma natural de cubrir un piso entero.
3. Bus RS-485 con nodos económicos por fila de plazas, que es lo que resuelve de
   verdad el problema de la distancia del USB.
4. Sensores magnéticos embebidos en el piso, que es lo que usan las
   instalaciones comerciales.

Para el prototipo alcanza con **una plaza instrumentada de verdad** y el resto
simulado desde el panel. Demostrar el ciclo completo sobre una plaza real prueba
exactamente lo mismo que sesenta.

---

## 8. Servicio de lectura de matrículas

Proceso Java independiente, corriendo en la misma computadora del parking que
el puente serie, que atiende las webcams de todas las plazas reservadas.

Su ciclo es simple porque el sensor le hizo la parte difícil:

1. Le pregunta a la API qué plazas reservadas acaban de ocuparse y todavía no
   tienen lectura (`GET /api/lecturas/pendientes`, cada pocos segundos; con tres
   o cuatro plazas, consultar por *polling* no justifica nada más elaborado).
2. Toma varias fotos de la webcam de esa plaza a lo largo de un minuto.
3. Sobre cada foto corre el lector: recorta la imagen hasta aislar la chapa, la
   lee y devuelve el texto con un valor de confianza.
4. Se queda con **la lectura que más se repite** entre todas las fotos. Que un
   auto estacionado no se mueva es lo que permite este lujo, y es la mejor
   defensa contra una lectura equivocada: un error de OCR rara vez se repite
   igual muchas veces seguidas.
5. Mira si esa matrícula lleva el distintivo de discapacidad —el bloque de
   letras termina en `DI`—. Es el último paso en que la chapa existe como texto.
6. Calcula el HMAC de esa matrícula y hace `POST /api/lecturas` con el hash, la
   confianza y el distintivo.

Nótese que el servicio **no decide si el vehículo está autorizado**: reporta dos
hechos —qué leyó, y si la chapa llevaba el distintivo— y nada más. Que el paso 5
viva acá no es comodidad: acá es el único lugar donde todavía se lo puede mirar,
porque después del paso 6 la matrícula deja de existir como texto en todo el
sistema (4.3). Que la decisión viva en el backend tampoco lo es: cambiar la
regla no puede obligar a reinstalar un programa en la computadora del parking.

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
| 4 | Distintivo | Se mira si el bloque de letras termina en `DI`, con la chapa todavía en texto |
| 5 | Hasheo | Se calcula el HMAC-SHA256 de la matrícula ya normalizada |

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
| `autorizado` | Se leyó con confianza ≥ 0,80 y la chapa lleva el distintivo `DI` | La plaza queda en verde: el vehículo puede estar ahí |
| `no_autorizado` | Se leyó con confianza ≥ 0,80 y la chapa no lo lleva | Se genera una alerta para revisión humana |
| `no_verificable` | El OCR no leyó nada, o leyó con confianza < 0,80 | No se puede afirmar nada sobre la chapa, y **no** se genera alerta |

**No poder leer la matrícula no es lo mismo que leerla y que no lleve el
distintivo.** Confundirlas convertiría cada lectura fallida en una falsa
infracción. Por eso `no_verificable` existe como estado separado y nunca dispara
una alerta por sí mismo.

El distintivo se comprueba sobre la matrícula **ya normalizada**, y por eso el
paso 2 de 9.2 no es un detalle: si cada bloque se corrige con su propio mapa,
una `O` del bloque de letras sigue siendo una letra y no se convierte en el `0`
que rompería el patrón. Y el `DI` tiene que estar al **final** del bloque de letras:
aceptarlo en cualquier posición daría por autorizada a una chapa común que
empiece con esas letras —`DIA 1234`—, y cada una de ésas es una plaza reservada
ocupada sin que nadie se entere.

Una plaza que no es de discapacidad no tiene nada que verificar. Si aun así
llega una lectura sobre ella —una cámara mal configurada—, el resultado es
`autorizado` y no se genera alerta: el error es de instalación, no una
infracción de quien estacionó.

### 9.4 Qué gatilla una alerta

Una sola cosa: **una plaza de discapacidad cuya lectura dio `no_autorizado`**.
La alerta nombra la plaza, porque la cámara pertenece a esa plaza y a ninguna
otra. No hay deducción por conteo ni ambigüedad sobre cuál es.

El motivo que se guarda es literal —«Vehículo sin distintivo de discapacidad en
plaza reservada»— y la alerta apunta a la lectura que la originó, así que quien
la revisa ve con cuánta confianza se leyó esa chapa.

Una lectura `no_verificable` **nunca** genera una alerta. No poder leer la
matrícula no es lo mismo que leerla y que no lleve el distintivo; confundirlas
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
│   │   ├── index.js              Monta los routers y el manejador de errores
│   │   ├── lib/
│   │   │   ├── supabase.js       Cliente de Supabase (secret key)
│   │   │   └── hash.js           SHA-256 de tokens de dispositivo
│   │   ├── plano/generar.js      Geometria de un nivel a partir de la cantidad de plazas
│   │   ├── routes/               niveles, plazas, eventos, lecturas, alertas
│   │   └── middleware/           adminAuth, deviceAuth, errorHandler
│   ├── scripts/crear_token_dispositivo.js   Tokens de dispositivo
│   ├── package.json
│   └── .env.example
├── vision/                       Lector de matrículas (Java)
│   ├── src/                      Recorte, lectura, normalización y hasheo
│   ├── config.example.json       Cámaras, URL de la API y clave del HMAC
│   └── README.md                 Cómo compilarlo y calibrar las cámaras
├── firmware/                     Arduino Uno
│   ├── README.md                 Conexionado y calibración
│   └── sensor_plaza/
│       └── sensor_plaza.ino      Mide, decide el estado y lo emite por serie
├── gateway/                      Puente serie (Node.js)
│   ├── src/
│   │   ├── index.js              Abre el puerto y traduce cada línea
│   │   ├── protocolo.js          Parser de LISTO / EVENTO / PING / DIST
│   │   └── api.js                POST /api/eventos con reintentos
│   ├── package.json
│   └── .env.example              Puerto serie, URL de la API y token
├── db/
│   ├── esquema.sql               Tablas y tipos
│   ├── funciones.sql             registrar_evento(): evento + estado en una operación
│   ├── politicas.sql             RLS y publicación de tiempo real
│   ├── datos_prueba.sql          El parking de las capturas, generado desde la base
│   └── migracion_sacar_padron.sql   Sólo para bases anteriores al 25/08/2026
├── Tinkercad/                    Diagramas del circuito
├── README.md
└── .gitignore
```

Los tres archivos con secretos —`api/.env`, `gateway/.env` y
`vision/config.json`— están en `.gitignore` y se crean copiando su respectivo
`.example`. **El sketch del Arduino no tiene archivo de secretos**, y ese es
justamente el punto de la sección 2.1.1.

Al día de hoy tienen archivos reales `web/`, `api/`, `db/` y el firmware del
sensor; `gateway/`, `vision/` y el resto del árbol son la estructura a la que
apunta el proyecto y se va llenando fase por fase.

---

## 11. Puesta en marcha

### Base de datos

Crear un proyecto en [supabase.com](https://supabase.com) y correr, desde el
editor SQL y **en este orden**, los cuatro archivos de `db/`:

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `esquema.sql` | Tablas y tipos |
| 2 | `funciones.sql` | `registrar_evento()`, que usa el `PATCH` de la API |
| 3 | `datos_prueba.sql` | El estacionamiento de las capturas: dos niveles, 50 plazas y los dos dispositivos |
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
URL de la API, el token del dispositivo, el índice de cada webcam y la clave
del HMAC. Esa clave no la conoce nadie más —el backend tampoco— pero tiene que
ser **estable**: si cambia, las lecturas nuevas de un mismo vehículo dejan de
coincidir con las viejas y el historial de la plaza queda partido en dos.

### Puente serie (opcional)

```bash
cd gateway
npm install
cp .env.example .env
npm start
```

En `.env` van el puerto serie del Arduino (`COM3` en Windows, `/dev/ttyACM0` en
Linux), la URL de la API y el token del dispositivo, que se genera con
`api/scripts/crear_token_dispositivo.js`. El puente necesita que la API esté levantada; el
Arduino, en cambio, funciona solo: si el puente no está, sigue midiendo y
mostrando el estado en sus LEDs, y lo que se pierde es el reporte.

### Firmware (opcional)

Ver [firmware/README.md](firmware/README.md). Se abre `sensor_plaza.ino` en el
IDE de Arduino, se elige la placa **Arduino Uno** y su puerto, y se sube. El
monitor serie a 115200 baudios muestra exactamente las líneas que va a leer el
puente.

**Un puerto serie lo abre un solo programa a la vez.** Si el monitor del IDE
está abierto, el puente no puede abrir el puerto, y al revés. Es la causa número
uno de "no anda" en esta parte del sistema.

---

## 12. Plan de fases

Cada fase entrega algo demostrable por sí solo. Las fases 1 a 5 **no requieren
hardware**: un retraso en la compra o una falla del Arduino no bloquea el
avance.

| # | Fase | Entregable | Hardware | Estado |
|---|---|---|---|---|
| 1 | Repositorio | Estructura, esquema SQL, documentación | No | Hecho |
| 2 | Plano estático | Plano SVG con selector de niveles y plazas de colores desde un JSON local | No | Hecho |
| 3 | Base de datos y API | Tablas en Supabase, `GET /api/plazas`, el plano consume la API | No | Hecho |
| 4 | Autenticación y panel | Login con Supabase Auth, cambio manual de estados | No | Hecho |
| 5 | Tiempo real | El plano se repinta solo al cambiar un estado | No | Hecho |
| 6a | Sensor | Arduino + HC-SR04 calibrado, emitiendo el protocolo serie de la sección 7.4 | Sí | Hecho |
| 6b | Puente | El puente traduce esas líneas en `POST /api/eventos` y el plano se repinta solo | Sí | Hecho |
| 7 | Cámara en la plaza | La webcam se dispara con el sensor y el lector Java devuelve el hash | Sí | Hecho |
| 8 | Autorización y alertas | Comprobación del distintivo, resolución de la autorización y bandeja de revisión | Sí | Hecho |

**Las ocho fases están cerradas.** El circuito completo se probó de punta a
punta el 25 de agosto de 2026 sobre la plaza A01: el sensor reporta por el
puente serie, la cámara se dispara sola, lee la chapa y comprueba el distintivo,
y la alerta aparece en la bandeja del panel sin recargar la página. Se probó con
una matrícula con distintivo y otra sin él, y las dos dieron el resultado
correcto.

El lector de matrículas —lo que en el plan original era la parte más riesgosa—
ya estaba desarrollado y probado sobre fotos fijas antes de la fase 7. Esa fase
no fue escribirlo: fue montarlo, calibrarlo y conectarlo.

El criterio de aceptación de la fase 3 conviene tenerlo escrito: se cambia la
constante `MODO` de `demo` a `real` y **la página tiene que verse idéntica**. Si
eso pasa, la separación entre la capa de datos y el plano era correcta.

**La fase 6 va partida en dos a propósito.** Tiene dos riesgos que no se parecen
en nada: uno es físico —¿el ultrasónico mide bien contra el techo de un auto, a
esa altura, con ese umbral?— y el otro es de integración —¿la línea llega, se
parsea y se convierte en una fila de la base?—. Montados juntos, un plano que no
se repinta puede ser cualquiera de los dos, y hay que ir descartando a ciegas.
Separados, cada falla tiene un solo lugar donde esconderse: la 6a se valida
entera contra el monitor serie, sin red y sin backend, y recién cuando emite las
líneas correctas se conecta el puente. El corte natural es el protocolo de la
sección 7.4, que es el contrato entre las dos mitades.

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
| El Arduino o el HC-SR04 se dañan | Medio | Fases 1-5 no lo requieren y el panel manual simula el sensor. Son las dos piezas más baratas y disponibles del proyecto: la reposición es inmediata |
| **La computadora del puente se apaga o se cuelga** | Alto | Es el punto único de falla que introduce este diseño, y se asume a cambio de sacar las credenciales del hardware (2.1.1). El Arduino sigue midiendo y mostrando su estado en los LEDs; al volver el puente, el `PING` de los 10 minutos reconstruye el estado. Mientras tanto la plaza cae a `sin_datos` a los 30 minutos, que es preferible a mostrar un dato viejo como si fuera actual |
| El USB no llega físicamente hasta la plaza | Medio | 5 m con cable común, 15 a 20 m con cable activo, 50 m con extensor sobre cable de red. Para la instalación definitiva, bus RS-485 (7.7). Para el prototipo se instrumenta una plaza cercana al puente |
| Alguien desenchufa el USB del Arduino | Medio | El puente detecta que el puerto se cerró, lo registra y reintenta abrirlo cada pocos segundos; la plaza cae a `sin_datos` y el plano lo muestra |
| El OCR lee mal y se marca a alguien como infractor | Alto | Umbral de 0,80; validación de formato; se exige la lectura repetida en varias fotos; `no_verificable` separado de `no_autorizado`; revisión humana obligatoria |
| Filtración de la base con el historial de lecturas | Alto | Sólo se guarda el HMAC; la clave vive fuera de la base; poda a 30 días; RLS **activado** y sin ninguna política en `lecturas`, `alertas`, `eventos` y `dispositivos`, de modo que la clave pública no devuelve una sola fila (`db/politicas.sql`) |
| La cámara no consigue un ángulo con la chapa visible | Medio | Montaje al frente de la plaza y a la altura de la matrícula; probar con el auto de frente y de culata; sin lectura no hay alerta, queda en `no_verificable` |
| La cámara capta a personas bajando del auto | Medio | Se dispara sólo por evento del sensor; la imagen se procesa en memoria y no se guarda nunca |
| Una cámara por plaza reservada encarece la instalación | Bajo | Son tres o cuatro por parking, no una por plaza; cámaras IP sobre la red existente y un solo proceso que las atiende |
| Un sensor por plaza no escala en costo | Medio | Compartir el TRIG y multiplexar varios sensores por Arduino, y varios Arduinos por puente (7.7); para el prototipo, una plaza real y el resto simulado |
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
- **Gateway (puente):** proceso que traduce entre un dispositivo que no habla
  con la red y una API que sí. Acá es el que lee el puerto serie del Arduino y
  hace las peticiones HTTP. Ver la sección 7.5.
- **Baudio:** velocidad de una línea serie, en símbolos por segundo. Los dos
  extremos tienen que estar configurados con el mismo valor; si no coinciden, lo
  que llega del otro lado son caracteres sin sentido.
- **Histéresis:** que haga falta más evidencia para volver atrás que para
  avanzar. Acá, 3 lecturas para dar la plaza por ocupada y 5 para darla por
  libre: evita que el estado oscile cuando la distancia queda justo en el
  umbral.
