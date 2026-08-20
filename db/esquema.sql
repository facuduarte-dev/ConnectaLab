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

-- Dos dispositivos con el mismo token rompen la autenticacion: la busqueda por
-- token_hash espera una sola fila y con dos devuelve error, que sale como un
-- 500 sin relacion aparente con el problema. Los null no chocan entre si en un
-- indice unico, asi que los sensores y camaras (que no tienen token propio)
-- conviven sin restriccion.
create unique index dispositivos_token_hash_unico on dispositivos (token_hash);

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