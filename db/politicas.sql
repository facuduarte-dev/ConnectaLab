-- ============================================================
-- Fase 5: politicas de acceso y publicacion de tiempo real
--
-- Dos cosas distintas que hacen falta las dos:
--   1. la tabla tiene que estar en la publicacion supabase_realtime,
--      porque Realtime lee el WAL a traves de ella y no la tabla;
--   2. el rol anon tiene que poder LEER la fila, porque antes de
--      mandar un cambio Realtime se hace pasar por el suscriptor y
--      comprueba si podria verla con un select.
-- Si falta cualquiera de las dos no llega nada, y sin error.
-- ============================================================

-- --- 1. Lectura publica: lo que el plano muestra ---------------------
--
-- El plano es publico: quien entra al sitio ve las plazas sin iniciar
-- sesion. Se habilita RLS igual y se agrega una politica de solo SELECT.
-- No es lo mismo que dejar RLS apagado: con la politica, anon LEE pero no
-- puede insertar, actualizar ni borrar. Con RLS apagado podria hacer las
-- cuatro cosas con la anon key, que esta publicada en el frontend.

alter table estacionamientos enable row level security;
alter table niveles          enable row level security;
alter table plazas           enable row level security;

drop policy if exists "lectura publica" on estacionamientos;
drop policy if exists "lectura publica" on niveles;
drop policy if exists "lectura publica" on plazas;

create policy "lectura publica" on estacionamientos
  for select to anon, authenticated using (true);

create policy "lectura publica" on niveles
  for select to anon, authenticated using (true);

create policy "lectura publica" on plazas
  for select to anon, authenticated using (true);

-- --- 2. Todo lo demas: cerrado ---------------------------------------
--
-- RLS habilitado y NINGUNA politica = ningun cliente con la anon key ve
-- una sola fila. La API no se entera del cambio: usa la service_role, que
-- por definicion pasa por encima de RLS. Y el sensor de la fase 6 tampoco,
-- porque tambien escribe a traves de la API.
--
-- Sin esto, cualquiera con la anon key —que esta en el HTML— podia bajarse el
-- historial de lecturas y la bandeja de alertas.

alter table eventos      enable row level security;
alter table dispositivos enable row level security;
alter table lecturas     enable row level security;
alter table alertas      enable row level security;

-- --- 3. Publicacion de tiempo real -----------------------------------
--
-- Solo plazas. niveles y estacionamientos no cambian mientras alguien mira
-- el plano: replicarlos seria trabajo del servidor para eventos que nunca
-- van a ocurrir.
--
-- Va dentro de un DO porque agregar dos veces la misma tabla es un error, y
-- este archivo tiene que poder correrse de nuevo sin romperse.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'plazas'
  ) then
    execute 'alter publication supabase_realtime add table plazas';
  end if;
end $$;