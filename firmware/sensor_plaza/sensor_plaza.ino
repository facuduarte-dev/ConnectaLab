/*
 * ParkEx - Sensor de ocupacion de una plaza
 *
 * Mide la distancia con un HC-SR04 montado en el cielorraso, apuntando hacia
 * abajo y centrado sobre la plaza (README 7.2), y decide cuando la plaza
 * cambia de estado (README 7.3).
 *
 * No habla con la red ni sabe que existe una API: emite el protocolo serie del
 * README 7.4 y el puente lo traduce a POST /api/eventos (README 2.1.1). Por eso
 * aca no hay tokens ni contraseñas: si alguien se lleva la placa, no se lleva
 * nada.
 */

// ---------------------------------------------------------------- Conexionado
//
// El HC-SR04 y el Uno trabajan los dos a 5 V, asi que ECHO entra directo y no
// lleva divisor de tension (README 7.1).

const int trigPin = 9;
const int echoPin = 8;

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

const int DISTANCIA_PISO_CM = 180;   // sensor a 2,3 m del piso
const int UMBRAL_CM         = 160;   // punto medio piso / techo del auto

const int DISTANCIA_MINIMA_CM = 2;   // fuera de este rango el HC-SR04 no mide
const int DISTANCIA_MAXIMA_CM = 400;

// -------------------------------------------------------------------- Reporte

const int PLAZA_ID = 1;                    // id de esta plaza en la base

const unsigned long INTERVALO_MEDICION_MS = 500;          // README 7.3, punto 1
const unsigned long INTERVALO_PING_MS     = 10UL * 60000; // README 7.3, punto 5

// Filtro anti falsos positivos: una persona caminando por delante no alcanza
// para dar la plaza por ocupada (README 7.3, puntos 2 y 3).
const int LECTURAS_PARA_OCUPADO = 3;
const int LECTURAS_PARA_LIBRE   = 5;

// El eco tarda ~58 us por centimetro; 25 ms cubre los 400 cm del sensor con
// margen. Sin timeout, pulseIn bloquea hasta un segundo cuando no vuelve nada.
const unsigned long TIMEOUT_ECO_US = 25000;

// ---------------------------------------------------------------------- Estado

bool ocupado = false;              // estado confirmado, el que se reporta
int lecturasOcupado = 0;           // consecutivas por debajo del umbral
int lecturasLibre   = 0;           // consecutivas por encima

bool primerReporte   = true;       // todavia no se reporto nada desde el arranque
int  lecturasValidas = 0;          // mediciones utiles desde el arranque
int  ultimaDistancia = -1;         // ultima medicion valida, para el PING

unsigned long ultimaMedicion = 0;
unsigned long ultimoPing     = 0;

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(ledRojo, OUTPUT);
  pinMode(ledVerde, OUTPUT);

  Serial.begin(115200);

  aplicarEstado();

  // LISTO solo avisa que la placa arranco. El estado en el que quedo la plaza
  // lo dice el PING inicial, que sale desde procesarMedicion() en cuanto haya
  // mediciones suficientes.
  Serial.print(F("LISTO;plaza="));
  Serial.println(PLAZA_ID);

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
  //
  // Si nunca hubo una medicion valida no se manda nada: el silencio es lo
  // correcto. Pingear "libre" con el sensor roto seria afirmar algo que nadie
  // comprobo, y justamente impediria que la plaza cayera en sin_datos.
  if (ultimaDistancia >= 0 && millis() - ultimoPing >= INTERVALO_PING_MS) {
    reportar(F("PING"), ultimaDistancia);
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
  // Se imprime ANTES del descarte, a proposito: al calibrar interesa ver los
  // -1, que son los que avisan que el sensor esta fuera de rango o apuntando
  // a una superficie que no le devuelve el eco.
  Serial.print(F("DIST;plaza="));
  Serial.print(PLAZA_ID);
  Serial.print(F(";distancia="));
  Serial.println(distancia);
#endif

  // Una lectura invalida no es "libre": no mueve ningun contador. Si el sensor
  // deja de responder del todo, el backend se entera por la falta de ping.
  if (distancia < 0) return;

  ultimaDistancia = distancia;

  // Deja de contar en cuanto el contador ya no se usa. Sin esto seguiria
  // subiendo para siempre y desbordaria el int a las pocas horas.
  if (primerReporte) lecturasValidas++;

  if (distancia <= UMBRAL_CM) {
    lecturasOcupado++;
    lecturasLibre = 0;
  } else {
    lecturasLibre++;
    lecturasOcupado = 0;
  }

  if (!ocupado && lecturasOcupado >= LECTURAS_PARA_OCUPADO) {
    ocupado = true;
    cambiarEstado(distancia);
  } else if (ocupado && lecturasLibre >= LECTURAS_PARA_LIBRE) {
    ocupado = false;
    cambiarEstado(distancia);
  }

  // Reporte inicial. Va al final para que la transicion tenga su chance
  // primero: si la plaza estaba ocupada al arrancar, el EVENTO ya salio en la
  // lectura 3 y bajo la bandera, asi que aca no se manda un PING repetido.
  // Se espera a LECTURAS_PARA_LIBRE por ser el mayor de los dos umbrales:
  // llegado ese punto el filtro ya decidio, en cualquiera de los dos sentidos.
  if (primerReporte && lecturasValidas >= LECTURAS_PARA_LIBRE) {
    reportar(F("PING"), distancia);
  }
}

// Solo se reporta cuando el estado cambia, no en cada lectura (README 7.3).
void cambiarEstado(int distancia) {
  aplicarEstado();
  reportar(F("EVENTO"), distancia);
}

void aplicarEstado() {
  digitalWrite(ledRojo,  ocupado ? HIGH : LOW);
  digitalWrite(ledVerde, ocupado ? LOW  : HIGH);
}

// Protocolo serie del README 7.4. Es la unica salida que consume el puente.
//
// Todo reporte pasa por aca, y por eso aca se reinicia el reloj del ping: si
// acabamos de decir en que estado estamos, el ping vuelve a contar desde cero.
// Repetir la misma informacion dos veces seguidas no aporta nada.
void reportar(const __FlashStringHelper* tipo, int distancia) {
  primerReporte = false;
  ultimoPing    = millis();

  Serial.print(tipo);
  Serial.print(F(";plaza="));
  Serial.print(PLAZA_ID);
  Serial.print(F(";estado="));
  Serial.print(ocupado ? F("ocupado") : F("libre"));
  Serial.print(F(";distancia="));
  Serial.println(distancia);
}