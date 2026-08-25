package com.parkex.ocr;
import org.opencv.core.Mat;
import org.opencv.videoio.*;
import java.util.*;
public final class CameraCapture implements AutoCloseable {
    private final VideoCapture capture;
    public CameraCapture(String source) {
        capture = new VideoCapture();
        if (source.matches("\\d+")) {
            int index = Integer.parseInt(source);
            // Los drivers de cámaras virtuales varían: DroidCam puede funcionar
            // con Media Foundation aunque DirectShow falle (o al revés).
            if (!capture.open(index, Videoio.CAP_MSMF)
                    && !capture.open(index, Videoio.CAP_DSHOW)) {
                capture.open(index, Videoio.CAP_ANY);
            }
        } else {
            capture.open(source, Videoio.CAP_ANY);
        }
        if (!capture.isOpened()) throw new IllegalArgumentException("No se pudo abrir la cámara/stream: " + source);
        capture.set(Videoio.CAP_PROP_FRAME_WIDTH, 1920); capture.set(Videoio.CAP_PROP_FRAME_HEIGHT, 1080);
        descartarCalentamiento();
    }

    // Una camara virtual no entrega imagen apenas se la abre: DroidCam manda
    // unos 2,5 s de cuadros de relleno —verde liso y despues negro con su marca
    // de agua— antes de que llegue el video del telefono. Sin este descarte las
    // dos primeras de las ocho capturas son ese relleno, y el consenso trabaja
    // con seis fotos creyendo que tiene ocho. Una webcam fisica tampoco pierde
    // nada: le da tiempo al autoexposicion a estabilizarse.
    //
    // Va al FINAL del constructor y no al principio: antes de capture.open() no
    // hay de donde leer, y read() sobre una captura cerrada no descarta nada.
    //
    // Es un tiempo fijo y no una deteccion del relleno a proposito. Descartar
    // "cuadros de un solo color" midiendo la varianza no distingue: el relleno
    // negro con la marca de agua da 7,07 de desvio y una foto real mal
    // encuadrada puede dar menos.
    private void descartarCalentamiento() {
        long limite = System.currentTimeMillis() + 3000;
        Mat descarte = new Mat();
        try {
            while (System.currentTimeMillis() < limite) capture.read(descarte);
        } finally { descarte.release(); }
    }

    public List<Mat> frames(int count, long intervalMs) throws InterruptedException {
        List<Mat> result = new ArrayList<>();
        for (int i=0; i<count; i++) { Mat frame = new Mat(); if (capture.read(frame) && !frame.empty()) result.add(frame.clone()); if (i+1<count) Thread.sleep(intervalMs); }
        return result;
    }
    public void close() { capture.release(); }
}
