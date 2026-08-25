# Sensor de ocupación de una plaza

Sketch de Arduino Uno para `sensor_plaza/sensor_plaza.ino`. Mide la distancia al
piso con un HC-SR04 montado en el cielorraso, decide si la plaza está ocupada y
lo escribe por el puerto serie. Las secciones 7.1 a 7.4 del README de la raíz
explican el circuito y el protocolo; acá está cómo subirlo y calibrarlo.

**El Arduino no habla con la red y no guarda ninguna credencial.** Escribe
líneas de texto por un cable USB y quien las traduce en peticiones a la API es
el puente, que corre en una computadora. Ése es el punto de la sección 2.1.1:
quien se lleve la placa no se lleva nada más que un microcontrolador.

## Conexionado

| Pin del Arduino | A qué va |
|---|---|
| `9` | `TRIG` del HC-SR04 |
| `8` | `ECHO` del HC-SR04 |
| `2` | LED rojo, con su resistencia. Encendido = plaza ocupada |
| `3` | LED verde, con su resistencia. Encendido = plaza libre |
| `5V` y `GND` | Alimentación del sensor |

Los LED no son decoración: son la única señal de que la placa sigue midiendo
cuando el puente está caído.

## Subir el sketch

Se abre `sensor_plaza/sensor_plaza.ino` en el IDE de Arduino, se elige la placa
**Arduino Uno** y su puerto, y se sube. El monitor serie a **115200 baudios**
muestra exactamente las líneas que va a leer el puente.

**Antes de subirlo hay que poner el id de la plaza.** En el sketch:

```cpp
const int PLAZA_ID = 1;   // id de esta plaza en la base
```

Es el `id` de la fila en la tabla `plazas`, no su código (`A01`). Si apunta a una
plaza de otro estacionamiento, la API responde 403 y el puente lo registra sin
reintentar.

## Calibrar el umbral

Es el paso que más se saltea y el que más problemas da. Los valores que vienen
en el sketch son para un sensor a 2,3 m del piso:

```cpp
const int DISTANCIA_PISO_CM = 180;   // sensor a 2,3 m del piso
const int UMBRAL_CM         = 160;   // punto medio piso / techo del auto
```

Sobre una mesa el sensor mide 20 o 30 cm, o sea **siempre** por debajo del
umbral, y la plaza queda ocupada para siempre. Para calibrar:

1. Descomentá `#define DEPURAR_DISTANCIA` y subí el sketch.
2. Abrí el monitor serie. Cada medio segundo escribe `DIST;plaza=1;distancia=NN`.
3. Anotá la distancia con la plaza **vacía** y con el obstáculo **puesto**.
4. Poné `UMBRAL_CM` en el punto medio entre las dos.
5. **Volvé a comentar `DEPURAR_DISTANCIA`** y subí de nuevo.

Si te olvidás el paso 5, el puerto escupe dos líneas por segundo. El puente las
descarta —`DIST` no describe un estado y no se reporta— pero la consola queda
ilegible.

Un `-1` en la salida no es una distancia: es una lectura inválida, o sea que no
volvió el eco. Se imprimen a propósito, porque son las que avisan que el sensor
está fuera de rango o apuntando a algo que no se lo devuelve. Una lectura
inválida **no** cuenta como "libre": no mueve ningún contador.

## Qué escribe

```
LISTO;plaza=1                                   la placa arrancó
DIST;plaza=1;distancia=143                      sólo con DEPURAR_DISTANCIA
EVENTO;plaza=1;estado=ocupado;distancia=87      cambió el estado
PING;plaza=1;estado=libre;distancia=229         sigue vivo, cada 10 minutos
```

Sólo se reporta cuando el estado **cambia**, no en cada medición. Hacen falta 3
lecturas seguidas por debajo del umbral para dar la plaza por ocupada y 5 por
encima para darla por libre: son un segundo y medio y dos segundos y medio.
Pedir más para liberarla que para ocuparla es deliberado, porque una persona
pasando por delante del sensor no puede liberar una plaza.

El `PING` de los 10 minutos es lo que impide que la plaza caiga a `sin_datos` a
la media hora. Si nunca hubo una medición válida no se manda nada: pingear
"libre" con el sensor roto sería afirmar algo que nadie comprobó.

## Cuando algo no anda

| Lo que ves | Qué es |
|---|---|
| El puente no puede abrir el puerto | Un puerto serie lo abre un solo programa a la vez. Cerrá el monitor serie del IDE |
| La plaza queda ocupada para siempre | `UMBRAL_CM` está por encima de la distancia al piso. Calibrá |
| Puros `-1` en el monitor | El sensor no recibe eco: fuera de rango, mal conectado, o apuntando a una superficie que lo dispersa |
| El puente dice `descartada:` | Llegó una línea que no entiende. Normal justo después de un reinicio de la placa |
| Nada llega a la API | El Arduino sigue midiendo y mostrándolo en los LED. El problema está en el puente o en la red |
