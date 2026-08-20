import { SerialPort } from 'serialport';

const puertos = await SerialPort.list();

if (puertos.length === 0) {
  console.log('No se detecto ningun puerto serie.');
} else {
  for (const p of puertos) {
    console.log(`${p.path.padEnd(6)} | ${p.manufacturer ?? 'sin fabricante'} | ${p.friendlyName ?? ''}`);
  }
}