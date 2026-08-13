import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { rutasNiveles } from './rutas/niveles.js';
import { rutasPlazas } from './rutas/plazas.js';

const app = express();

app.use(cors({ origin: process.env.ORIGEN_WEB }));
app.use(express.json());
app.use('/api', rutasNiveles);
app.use('/api', rutasPlazas);

const puerto = process.env.PORT ?? 3000;
app.listen(puerto, () => console.log(`API en http://localhost:${puerto}`));