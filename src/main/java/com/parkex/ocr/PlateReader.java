package com.parkex.ocr;
import org.opencv.core.Mat;
import java.util.Comparator;
import java.util.List;
public final class PlateReader {
    private final PlateDetector detector; private final TesseractCli tesseract;
    public PlateReader(PlateDetector detector, TesseractCli tesseract) { this.detector = detector; this.tesseract = tesseract; }
    public OcrResult read(Mat frame) {
        OcrResult best=OcrResult.unreadable();
        for(Mat candidate:detector.candidates(frame)) {
            OcrResult candidateBest=OcrResult.unreadable();
            for(Mat image:detector.preprocess(candidate)) {
                try { candidateBest=tesseract.read(image); } catch(Exception ignored) { }
                if(!candidateBest.plate().isEmpty()) break;
            }
            if(candidateBest.confidence()>best.confidence()) best=candidateBest;
            // Los candidatos están ordenados por aspecto de chapa. Una lectura
            // con formato válido se confirma luego entre varias capturas.
            if(!candidateBest.plate().isEmpty()) return candidateBest;
        }
        return best;
    }
}
