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
    }
    public List<Mat> frames(int count, long intervalMs) throws InterruptedException {
        List<Mat> result = new ArrayList<>();
        for (int i=0; i<count; i++) { Mat frame = new Mat(); if (capture.read(frame) && !frame.empty()) result.add(frame.clone()); if (i+1<count) Thread.sleep(intervalMs); }
        return result;
    }
    public void close() { capture.release(); }
}
