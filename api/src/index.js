import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { nivelesRouter } from './routes/niveles.js';
import { plazasRouter } from './routes/plazas.js';
import { eventosRouter } from './routes/eventos.js';
import { lecturasRouter } from './routes/lecturas.js';
import { alertasRouter } from './routes/alertas.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Ruta simple para confirmar que el servidor esta vivo.
app.get('/', (req, res) => {
  res.json({ ok: true, servicio: 'ConectaLAB API' });
});

app.use('/api/niveles', nivelesRouter);
app.use('/api/plazas', plazasRouter);
app.use('/api/eventos', eventosRouter);
app.use('/api/lecturas', lecturasRouter);
app.use('/api/alertas', alertasRouter);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ConectaLAB API escuchando en http://localhost:${PORT}`);
});
