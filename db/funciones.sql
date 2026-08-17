create or replace function registrar_evento(
  p_plaza_id  integer,
  p_estado    estado_plaza,
  p_fuente    fuente_evento,
  p_confianza real default 1.0
) returns plazas
language plpgsql
as $$
declare
  v_tipo  tipo_plaza;
  v_autor autorizacion_plaza;
  v_plaza plazas;
begin
  select tipo into v_tipo from plazas where id = p_plaza_id;
  if not found then
    raise exception 'La plaza % no existe', p_plaza_id;
  end if;

  insert into eventos (plaza_id, estado, fuente, confianza)
  values (p_plaza_id, p_estado, p_fuente, p_confianza);

  -- Seccion 4.4 del README: la autorizacion describe al vehiculo que esta en
  -- la plaza, no a la plaza. Por eso se recalcula en cada cambio de estado en
  -- vez de arrastrar el valor anterior.
  v_autor := case
    when p_estado = 'ocupado' and v_tipo = 'discapacidad' then 'pendiente'
    else 'no_aplica'
  end;

  update plazas
     set estado = p_estado,
         autorizacion = v_autor,
         actualizado_en = now()
   where id = p_plaza_id
  returning * into v_plaza;

  return v_plaza;
end;
$$;

-- ============================================================
-- Alta y baja de pisos
-- ============================================================

/**
 * Crea un nivel con todas sus plazas en UNA operacion.
 *
 * El motivo de que sea una funcion y no dos insert desde Express es el mismo
 * que en registrar_evento(): adentro de la funcion las dos escrituras son una
 * sola transaccion. Si el insert de plazas falla —un codigo repetido, un tipo
 * invalido— se deshace tambien el insert del nivel. Hecho desde Express serian
 * dos viajes independientes, y un fallo en el segundo dejaria un piso vacio en
 * la base que nadie pidio y que hay que ir a limpiar a mano.
 *
 * Las plazas llegan como jsonb y no como columnas sueltas porque son una
 * cantidad variable: no se puede pasar "24 plazas" como parametros.
 */
create or replace function crear_nivel(
  p_estacionamiento_id integer,
  p_nombre             text,
  p_ancho_plano        integer,
  p_alto_plano         integer,
  p_plazas             jsonb
) returns niveles
language plpgsql
as $$
declare
  v_orden smallint;
  v_nivel niveles;
begin
  if not exists (select 1 from estacionamientos where id = p_estacionamiento_id) then
    raise exception 'El estacionamiento % no existe', p_estacionamiento_id;
  end if;

  -- El orden define la posicion en el riel de niveles y tiene un unique junto
  -- con el estacionamiento. Se calcula aca adentro para que el cliente no
  -- tenga que saber nada de eso.
  --
  -- Ojo con la garantia: dos altas simultaneas podrian leer el mismo maximo y
  -- elegir el mismo numero. Lo que impide que queden dos pisos con el mismo
  -- orden NO es este select, es la restriccion unique de la tabla: la segunda
  -- transaccion falla. Calcularlo aca achica la ventana, no la cierra. Con un
  -- administrador no se va a dar nunca, pero conviene saber donde esta de
  -- verdad la garantia.
  select coalesce(max(orden), 0) + 1 into v_orden
    from niveles where estacionamiento_id = p_estacionamiento_id;

  insert into niveles (estacionamiento_id, nombre, orden, ancho_plano, alto_plano)
  values (p_estacionamiento_id, p_nombre, v_orden, p_ancho_plano, p_alto_plano)
  returning * into v_nivel;

  -- estado y autorizacion se dejan en su valor por defecto: 'sin_datos' y
  -- 'no_aplica'. Es lo correcto y no un descuido. Una plaza recien creada no
  -- tiene ningun sensor reportando todavia, y decir 'libre' seria afirmar algo
  -- que nadie comprobo. En el plano se ven grises hasta el primer evento.
  insert into plazas (nivel_id, codigo, x, y, ancho, alto, tipo)
  select v_nivel.id,
         plaza->>'codigo',
         (plaza->>'x')::integer,
         (plaza->>'y')::integer,
         (plaza->>'ancho')::integer,
         (plaza->>'alto')::integer,
         (plaza->>'tipo')::tipo_plaza
    from jsonb_array_elements(p_plazas) as plaza;

  return v_nivel;
end;
$$;

/**
 * Borra un nivel, pero solo si nunca reporto nada.
 *
 * plazas tiene claves foraneas entrantes desde eventos, dispositivos, lecturas
 * y alertas. Borrar un piso con historial obligaria a borrar ese historial, y
 * el README (§4.1) es explicito: eventos nunca se actualiza ni se borra, es la
 * auditoria del sistema.
 *
 * Se cuenta a mano en vez de dejar que reviente la clave foranea porque el
 * error de Postgres dice 'violates foreign key constraint eventos_plaza_id_fkey',
 * que no le explica nada a quien esta usando el panel.
 */
create or replace function borrar_nivel(p_nivel_id integer)
returns void
language plpgsql
as $$
declare
  v_eventos      integer;
  v_dispositivos integer;
  v_lecturas     integer;
  v_alertas      integer;
begin
  if not exists (select 1 from niveles where id = p_nivel_id) then
    raise exception 'El nivel % no existe', p_nivel_id;
  end if;

  select count(*) into v_eventos
    from eventos e join plazas p on p.id = e.plaza_id where p.nivel_id = p_nivel_id;

  select count(*) into v_dispositivos
    from dispositivos d join plazas p on p.id = d.plaza_id where p.nivel_id = p_nivel_id;

  select count(*) into v_lecturas
    from lecturas l join plazas p on p.id = l.plaza_id where p.nivel_id = p_nivel_id;

  select count(*) into v_alertas
    from alertas a join plazas p on p.id = a.plaza_id where p.nivel_id = p_nivel_id;

  if v_eventos + v_dispositivos + v_lecturas + v_alertas > 0 then
    -- El errcode es lo que despues deja al backend responder 409 y no 500:
    -- esto no es una falla del servidor, es una negativa deliberada.
    raise exception
      'El piso tiene historial (% eventos, % dispositivos, % lecturas, % alertas) y no se puede borrar',
      v_eventos, v_dispositivos, v_lecturas, v_alertas
      using errcode = 'restrict_violation';
  end if;

  delete from plazas where nivel_id = p_nivel_id;
  delete from niveles where id = p_nivel_id;
end;
$$;