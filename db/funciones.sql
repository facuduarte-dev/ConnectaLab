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