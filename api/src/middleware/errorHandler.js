// Cualquier next(err) en una ruta termina aca. Asi ninguna ruta necesita
// su propio try/catch de "que le muestro al cliente si algo explota".
export function errorHandler(err, req, res, next) {
  console.error(err);

  const status = err.status || 500;
  const mensaje = status === 500 ? 'Error interno del servidor' : err.message;

  res.status(status).json({ error: mensaje });
}
