-- ConectaLAB — Datos de prueba
-- Correr DESPUES de esquema.sql, en el editor SQL de Supabase.

-- 1. Estacionamiento
insert into estacionamientos (id, nombre, direccion, activo) values
  (1, 'Parking Torre Centro', 'Av. 18 de Julio 1234, Montevideo', true);

-- 2. Niveles (definen el sistema de coordenadas del plano)
insert into niveles (id, estacionamiento_id, nombre, orden, ancho_plano, alto_plano) values
  (1, 1, 'Subsuelo 1', 1, 800, 400),
  (2, 1, 'Planta baja', 2, 800, 400);

-- 3. Plazas (mezcla de tipos y estados para poder probar el plano completo)
insert into plazas (id, nivel_id, codigo, x, y, ancho, alto, tipo, estado, autorizacion) values
  (1,  1, 'S1-01', 40,  40, 40, 80, 'normal',        'libre',      'no_aplica'),
  (2,  1, 'S1-02', 90,  40, 40, 80, 'normal',        'ocupado',    'no_aplica'),
  (3,  1, 'S1-03', 140, 40, 40, 80, 'discapacidad',  'ocupado',    'pendiente'),
  (4,  1, 'S1-04', 190, 40, 40, 80, 'discapacidad',  'ocupado',    'no_autorizado'),
  (5,  2, 'PB-01', 40,  40, 40, 80, 'normal',        'libre',      'no_aplica'),
  (6,  2, 'PB-02', 90,  40, 40, 80, 'moto',          'libre',      'no_aplica'),
  (7,  2, 'PB-03', 140, 40, 40, 80, 'carga',         'reservado',  'no_aplica'),
  (8,  2, 'PB-04', 190, 40, 40, 80, 'discapacidad',  'ocupado',    'autorizado');

-- 4. Eventos (historial de ocupacion reportado por sensores/manual)
insert into eventos (plaza_id, estado, fuente, confianza) values
  (2, 'ocupado', 'sensor', 1.0),
  (3, 'ocupado', 'sensor', 1.0),
  (4, 'ocupado', 'sensor', 1.0),
  (7, 'reservado', 'manual', 1.0),
  (8, 'ocupado', 'sensor', 1.0);

-- 5. Dispositivos (un sensor por plaza reservada + una camara en cada una)
--    token_hash es un valor de ejemplo, no un hash real todavia.
insert into dispositivos (estacionamiento_id, plaza_id, tipo, token_hash, descripcion, activo) values
  (1, 3, 'sensor', 'hash_sensor_s1_03_demo', 'Sensor HC-SR04 plaza S1-03', true),
  (1, 3, 'camara', 'hash_camara_s1_03_demo', 'Camara plaza discapacidad S1-03', true),
  (1, 4, 'sensor', 'hash_sensor_s1_04_demo', 'Sensor HC-SR04 plaza S1-04', true),
  (1, 4, 'camara', 'hash_camara_s1_04_demo', 'Camara plaza discapacidad S1-04', true),
  (1, 8, 'sensor', 'hash_sensor_pb_04_demo', 'Sensor HC-SR04 plaza PB-04', true),
  (1, 8, 'camara', 'hash_camara_pb_04_demo', 'Camara plaza discapacidad PB-04', true);

-- 6. Vehiculos autorizados (padron propio del parking; matricula_hash es de ejemplo)
insert into vehiculos_autorizados (id, estacionamiento_id, matricula_hash, tipo_permiso, referencia, activo) values
  (1, 1, 'hash_matricula_demo_001', 'discapacidad', 'Unidad 402', true),
  (2, 1, 'hash_matricula_demo_002', 'abonado', 'Unidad 118', true);

-- 7. Lecturas (intentos de lectura de matricula en plazas reservadas)
insert into lecturas (plaza_id, matricula_hash, confianza, resultado, vehiculo_id) values
  (8, 'hash_matricula_demo_001', 0.93, 'autorizado', 1),
  (4, 'hash_matricula_demo_999', 0.85, 'no_autorizado', null),
  (3, null, 0.0, 'no_verificable', null);

-- 8. Alertas (van a revision humana, nunca sancionan automaticamente)
insert into alertas (plaza_id, lectura_id, motivo, revisada) values
  (4, (select id from lecturas where plaza_id = 4 order by id desc limit 1),
      'Matricula no encontrada en el padron de autorizados', false);
