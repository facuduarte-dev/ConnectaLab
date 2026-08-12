const int trigPin = 9;
const int echoPin = 8;
const int ledRojo = 2;
const int ledVerde = 3;

long duracion;
int distancia;

// Se amplía el umbral al rango completo del cono (330 cm)
const int UMBRAL_ESTACIONADO = 300; 

bool estadoAnteriorOcupado = false; 

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(ledRojo, OUTPUT);
  pinMode(ledVerde, OUTPUT);
  
  Serial.begin(9600);

  digitalWrite(ledRojo, LOW);
  digitalWrite(ledVerde, HIGH);
  Serial.println("SISTEMA INICIADO - ESTADO: LUGAR LIBRE");
}

void loop() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  duracion = pulseIn(echoPin, HIGH);
  distancia = duracion * 0.034 / 2;

  // Detecta cualquier distancia mayor a 0 y dentro del cono verde (hasta 330 cm)
  bool estadoActualOcupado = (distancia > 0 && distancia <= UMBRAL_ESTACIONADO);

  if (estadoActualOcupado != estadoAnteriorOcupado) {
    if (estadoActualOcupado) {
      digitalWrite(ledRojo, LOW);
      digitalWrite(ledVerde, HIGH);
      Serial.println("ESTADO: LUGAR OCUPADO");
    } else {
      digitalWrite(ledRojo, HIGH);
      digitalWrite(ledVerde, LOW);
      Serial.println("ESTADO: LUGAR LIBRE");
    }

    estadoAnteriorOcupado = estadoActualOcupado;
  }

  delay(100);
}