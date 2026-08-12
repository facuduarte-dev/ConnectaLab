/*
 * ConectaLAB - Sensor de ocupacion de una plaza
 *
 * Mide la distancia con un HC-SR04 montado en el cielorraso, apuntando hacia
 * abajo y centrado sobre la plaza (README 7.2), y reporta a la API cada vez que
 * la plaza cambia de estado (README 7.3).
 *
 * Se compila igual para Arduino (etapa de prueba, sin WiFi: el reporte sale por
 * el monitor serie) y para ESP32 (etapa final: el mismo reporte va por HTTP).
 */

// ---------------------------------------------------------------- Conexionado
//
// En el ESP32 el pin ECHO entrega 5 V y la entrada tolera 3.3 V: hay que
// intercalar el divisor de 1k + 2k del README 7.1 o la placa se degrada.

#if defined(ESP32)
  const int trigPin = 5;    // GPIO 5
  const int echoPin = 18;   // GPIO 18, mediante divisor de tension
#else
  const int trigPin = 9;    // Arduino Uno
  const int echoPin = 8;
#endif

const int ledRojo  = 2;     // encendido = plaza ocupada
const int ledVerde = 3;     // encendido = plaza libre

// ---------------------------------------------------------------- Calibracion
//
// Con la plaza vacia el sensor mide la distancia al piso; con un auto debajo,
// la distancia al techo del vehiculo. El umbral va entre esos dos valores.
//
// Para calibrar: descomentar DEPURAR_DISTANCIA, anotar la lectura con la plaza
// vacia y con el auto adentro, y poner el umbral en el punto medio.

// #define DEPURAR_DISTANCIA

const int DISTANCIA_PISO_CM = 230;   // sensor a 2,3 m del piso
const int UMBRAL_CM         = 150;   // punto medio piso / techo del auto

const int DISTANCIA_MINIMA_CM = 2;   // fuera de este rango el HC-SR04 no mide
const int DISTANCIA_MAXIMA_CM = 400;

// -------------------------------------------------------------------- Reporte

const int PLAZA_ID = 1;                    // id de esta plaza en la base
const float CONFIANZA_SENSOR = 0.8;        // README 5, cuerpo de /api/eventos

const unsigned long INTERVALO_MEDICION_MS = 500;          // README 7.3, punto 1
const unsigned long INTERVALO_PING_MS     = 10UL * 60000; // README 7.3, punto 5

// Filtro anti falsos positivos: una persona caminando por delante no alcanza
// para dar la plaza por ocupada (README 7.3, puntos 2 y 3).
const int LECTURAS_PARA_OCUPADO = 3;
const int LECTURAS_PARA_LIBRE   = 5;

// El eco tarda ~58 us por centimetro; 25 ms cubre los 400 cm del sensor con
// margen. Sin timeout, pulseIn bloquea hasta un segundo cuando no vuelve nada.
const unsigned long TIMEOUT_ECO_US = 25000;

bool ocupado = false;              // estado confirmado, el que se reporta
int lecturasOcupado = 0;           // consecutivas por debajo del umbral
int lecturasLibre   = 0;           // consecutivas por encima

unsigned long ultimaMedicion = 0;
unsigned long ultimoPing     = 0;

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(ledRojo, OUTPUT);
  pinMode(ledVerde, OUTPUT);

  Serial.begin(115200);

  aplicarEstado();
  Serial.println(F("SISTEMA INICIADO - ESTADO: LUGAR LIBRE"));
  reportarEstado();
  ultimoPing = millis();
}

void loop() {
  unsigned long ahora = millis();

  if (ahora - ultimaMedicion >= INTERVALO_MEDICION_MS) {
    ultimaMedicion = ahora;
    procesarMedicion(medirDistancia());
  }

  // El ping le dice al backend que el sensor sigue vivo aunque no haya cambios;
  // sin el, a los 30 minutos la plaza pasaria a sin_datos (README 4.4).
  if (ahora - ultimoPing >= INTERVALO_PING_MS) {
    ultimoPing = ahora;
    reportarEstado();
  }
}

// Devuelve la distancia en cm, o -1 si la lectura no es valida.
int medirDistancia() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long duracion = pulseIn(echoPin, HIGH, TIMEOUT_ECO_US);
  if (duracion == 0) return -1;            // no volvio el eco

  int distancia = duracion * 0.034 / 2;
  if (distancia < DISTANCIA_MINIMA_CM || distancia > DISTANCIA_MAXIMA_CM) {
    return -1;                             // fuera del rango util del sensor
  }
  return distancia;
}

void procesarMedicion(int distancia) {
#ifdef DEPURAR_DISTANCIA
  Serial.print(F("distancia: "));
  Serial.println(distancia);
#endif

  // Una lectura invalida no es "libre": no mueve ningun contador. Si el sensor
  // deja de responder del todo, el backend se entera por la falta de ping.
  if (distancia < 0) return;

  if (distancia <= UMBRAL_CM) {
    lecturasOcupado++;
    lecturasLibre = 0;
  } else {
    lecturasLibre++;
    lecturasOcupado = 0;
  }

  if (!ocupado && lecturasOcupado >= LECTURAS_PARA_OCUPADO) {
    ocupado = true;
    cambiarEstado();
  } else if (ocupado && lecturasLibre >= LECTURAS_PARA_LIBRE) {
    ocupado = false;
    cambiarEstado();
  }
}

// Solo se reporta cuando el estado cambia, no en cada lectura (README 7.3).
void cambiarEstado() {
  aplicarEstado();
  Serial.println(ocupado ? F("ESTADO: LUGAR OCUPADO") : F("ESTADO: LUGAR LIBRE"));
  reportarEstado();
}

void aplicarEstado() {
  digitalWrite(ledRojo,  ocupado ? HIGH : LOW);
  digitalWrite(ledVerde, ocupado ? LOW  : HIGH);
}

// Cuerpo de POST /api/eventos (README 5). En el Arduino sale por el monitor
// serie; en el ESP32 este es el JSON que se envia con el token del dispositivo
// en el header Authorization: Bearer <token>.
void reportarEstado() {
  Serial.print(F("POST /api/eventos {\"plaza_id\":"));
  Serial.print(PLAZA_ID);
  Serial.print(F(",\"estado\":\""));
  Serial.print(ocupado ? F("ocupado") : F("libre"));
  Serial.print(F("\",\"fuente\":\"sensor\",\"confianza\":"));
  Serial.print(CONFIANZA_SENSOR, 2);
  Serial.println(F("}"));
}
