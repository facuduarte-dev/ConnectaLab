-- ParkEx - Datos de prueba
--
-- Generado desde la base real. Reproduce el parking que se ve en las capturas
-- del informe: dos niveles y las plazas A01-C10, con A01 como la plaza de
-- discapacidad instrumentada.
--
-- Correr DESPUES de esquema.sql y funciones.sql, y ANTES de politicas.sql.

-- 1. Estacionamiento
insert into estacionamientos (id, nombre, direccion, activo) values
  (1, 'Parking Ciudad Vieja', 'Ciudad Vieja, Montevideo', true);

-- 2. Niveles. 'orden' es la posicion en el riel del plano, y ancho_plano y
--    alto_plano son el viewBox del SVG: las plazas se posicionan adentro.
insert into niveles (id, estacionamiento_id, nombre, orden, ancho_plano, alto_plano) values
  (1, 1, 'Subsuelo 1', 2, 580, 520),
  (2, 1, 'Planta baja', 1, 580, 400);

-- 3. Plazas. x, y, ancho y alto son coordenadas del PLANO, no geograficas.
--
--    estado y autorizacion son una FOTO del momento en que se genero este
--    archivo, y estan para que el plano se vea poblado al abrirlo. En una
--    instalacion de verdad los escribe el sensor: una plaza recien creada
--    arranca en 'sin_datos', porque nadie comprobo todavia si hay un auto.
insert into plazas (id, nivel_id, codigo, x, y, ancho, alto, tipo, estado, autorizacion) values
  ( 1, 1, 'A01',  50,  40, 40, 80, 'discapacidad'  , 'ocupado'   , 'autorizado'),
  ( 2, 1, 'A02',  98,  40, 40, 80, 'discapacidad'  , 'libre'     , 'no_aplica'),
  ( 3, 1, 'A03', 146,  40, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  ( 4, 1, 'A04', 194,  40, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  ( 5, 1, 'A05', 242,  40, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  ( 6, 1, 'A06', 290,  40, 40, 80, 'normal'        , 'reservado' , 'no_aplica'),
  ( 7, 1, 'A07', 338,  40, 40, 80, 'normal'        , 'reservado' , 'no_aplica'),
  ( 8, 1, 'A08', 386,  40, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  ( 9, 1, 'A09', 434,  40, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (10, 1, 'A10', 482,  40, 40, 80, 'normal'        , 'sin_datos' , 'no_aplica'),
  (11, 1, 'B01',  50, 240, 40, 80, 'discapacidad'  , 'libre'     , 'no_aplica'),
  (12, 1, 'B02',  98, 240, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (13, 1, 'B03', 146, 240, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (14, 1, 'B04', 194, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (15, 1, 'B05', 242, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (16, 1, 'B06', 290, 240, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (17, 1, 'B07', 338, 240, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (18, 1, 'B08', 386, 240, 40, 80, 'normal'        , 'sin_datos' , 'no_aplica'),
  (19, 1, 'B09', 434, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (20, 1, 'B10', 482, 240, 40, 80, 'carga'         , 'libre'     , 'no_aplica'),
  (21, 1, 'C01',  50, 325, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (22, 1, 'C02',  98, 325, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (23, 1, 'C03', 146, 325, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (24, 1, 'C04', 194, 325, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (25, 1, 'C05', 242, 325, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (26, 1, 'C06', 290, 325, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (27, 1, 'C07', 338, 325, 40, 80, 'normal'        , 'reservado' , 'no_aplica'),
  (28, 1, 'C08', 386, 325, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (29, 1, 'C09', 434, 325, 40, 80, 'moto'          , 'ocupado'   , 'no_aplica'),
  (30, 1, 'C10', 482, 325, 40, 80, 'moto'          , 'libre'     , 'no_aplica'),
  (31, 2, 'A01',  50,  40, 40, 80, 'discapacidad'  , 'libre'     , 'no_aplica'),
  (32, 2, 'A02',  98,  40, 40, 80, 'discapacidad'  , 'libre'     , 'no_aplica'),
  (33, 2, 'A03', 146,  40, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (34, 2, 'A04', 194,  40, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (35, 2, 'A05', 242,  40, 40, 80, 'normal'        , 'ocupado'   , 'no_aplica'),
  (36, 2, 'A06', 290,  40, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (37, 2, 'A07', 338,  40, 40, 80, 'normal'        , 'reservado' , 'no_aplica'),
  (38, 2, 'A08', 386,  40, 40, 80, 'normal'        , 'reservado' , 'no_aplica'),
  (39, 2, 'A09', 434,  40, 40, 80, 'normal'        , 'reservado' , 'no_aplica'),
  (40, 2, 'A10', 482,  40, 40, 80, 'normal'        , 'reservado' , 'no_aplica'),
  (41, 2, 'B01',  50, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (42, 2, 'B02',  98, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (43, 2, 'B03', 146, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (44, 2, 'B04', 194, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (45, 2, 'B05', 242, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (46, 2, 'B06', 290, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (47, 2, 'B07', 338, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (48, 2, 'B08', 386, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (49, 2, 'B09', 434, 240, 40, 80, 'normal'        , 'libre'     , 'no_aplica'),
  (50, 2, 'B10', 482, 240, 40, 80, 'carga'         , 'libre'     , 'no_aplica');

-- 4. Dispositivos.
--
--    Esta tabla es dos cosas a la vez: el INVENTARIO de lo que hay instalado
--    y las CREDENCIALES de lo que se autentica (README 4.2).
--
--    El Arduino de la plaza no figura como dispositivo con token porque no
--    habla con la red: escribe distancias por un cable y quien reporta es el
--    puente (README 2.1.1). Los dos que si se autentican son el puente, que
--    cubre todo el estacionamiento y por eso lleva plaza_id en null, y la
--    camara de la plaza reservada, atada a A01.
--
--    Los dos van con token_hash en NULL a proposito: un token es un secreto y
--    no se versiona. Se generan despues de correr este archivo, uno por
--    dispositivo, y se pegan con los update de abajo:
--
--      cd api && node scripts/crear_token_dispositivo.js
--
--    El comando imprime el token EN CLARO -que va en gateway/.env o en
--    vision/config.json- y su hash, que es lo que va en la columna. Mientras
--    token_hash siga en null, ese dispositivo recibe 401 en cada peticion.
insert into dispositivos (id, estacionamiento_id, plaza_id, tipo, token_hash, descripcion, activo) values
  (1, 1, null, 'gateway', null, 'Puente serie de la computadora del parking', true),
  (3, 1, 1, 'camara', null, 'Webcam plaza A01', true);

-- update dispositivos set token_hash = 'PEGAR-EL-HASH-DEL-PUENTE'  where id = 1;
-- update dispositivos set token_hash = 'PEGAR-EL-HASH-DE-LA-CAMARA' where id = 3;

-- 5. Las secuencias.
--
--    Los id de arriba se insertan a mano, y eso NO mueve el contador de la
--    secuencia. Sin esto, el primer alta hecha desde el panel intenta usar el
--    id 1, choca con la clave primaria y falla con un error de duplicado que
--    no tiene nada que ver con lo que la persona estaba haciendo.
select setval('estacionamientos_id_seq', (select max(id) from estacionamientos));
select setval('niveles_id_seq',          (select max(id) from niveles));
select setval('plazas_id_seq',           (select max(id) from plazas));
select setval('dispositivos_id_seq',     (select max(id) from dispositivos));

-- No se cargan eventos, lecturas ni alertas. Son el historial del sistema y
-- fabricarlo seria escribir una auditoria de cosas que nunca pasaron: eventos
-- no se actualiza ni se borra nunca (README 4.1), y una alerta inventada
-- ocuparia la bandeja de revision humana sin que nadie haya estacionado mal.
-- Se llenan solos en cuanto el sensor y la camara empiezan a reportar.
