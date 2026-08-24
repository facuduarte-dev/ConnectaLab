package com.parkex.ocr;
import org.opencv.core.*;
import org.opencv.imgproc.Imgproc;
import org.opencv.imgcodecs.Imgcodecs;
import java.nio.file.*;
import java.util.*;
public final class PlateDetector {
    public List<Mat> candidates(Mat frame) {
        Mat gray = new Mat(), edges = new Mat(), hierarchy = new Mat();
        Imgproc.cvtColor(frame, gray, Imgproc.COLOR_BGR2GRAY); Imgproc.Canny(gray, edges, 100, 200);
        List<Rect> rectangles = new ArrayList<>();
        List<MatOfPoint> contours = new ArrayList<>();
        Imgproc.findContours(edges.clone(), contours, hierarchy, Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE);
        contours.stream().map(Imgproc::boundingRect).forEach(rectangles::add);

        // En chapas reales el marco suele estar cortado por tornillos, reflejos o
        // sombras. Cerramos pequeños huecos y buscamos también contornos internos.
        Mat closed = new Mat();
        Imgproc.morphologyEx(edges, closed, Imgproc.MORPH_CLOSE,
                Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new Size(17, 5)));
        contours.clear();
        Imgproc.findContours(closed, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE);
        contours.stream().map(Imgproc::boundingRect).forEach(rectangles::add);

        // Las chapas reflectivas claras sobre vehículos oscuros o de color se
        // separan mejor por luminosidad que por su borde exterior.
        Mat bright = new Mat();
        Imgproc.threshold(gray, bright, 145, 255, Imgproc.THRESH_BINARY);
        Imgproc.morphologyEx(bright, bright, Imgproc.MORPH_CLOSE,
                Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new Size(21, 9)));
        contours.clear();
        Imgproc.findContours(bright, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE);
        contours.stream().map(Imgproc::boundingRect).forEach(rectangles::add);
        double area = frame.width() * (double) frame.height();
        List<Mat> result = rectangles.stream().filter(r -> r.width >= 70 && r.height >= 18)
                .filter(r -> r.width / (double) r.height >= 2 && r.width / (double) r.height <= 6.5)
                .filter(r -> r.area() >= area * .002 && r.area() <= area * .20)
                .sorted(Comparator.comparingDouble(this::plateScore).reversed()).limit(40)
                .map(r -> new Mat(frame, r).clone()).toList();
        saveDebugCandidates(result);
        return result;
    }
    private void saveDebugCandidates(List<Mat> candidates) {
        String directory = System.getenv("DEBUG_DIR");
        if (directory == null || directory.isBlank()) return;
        try {
            Path path = Path.of(directory, "candidatos"); Files.createDirectories(path);
            for (int i=0; i<candidates.size(); i++) Imgcodecs.imwrite(path.resolve("candidato_"+(i+1)+".jpg").toString(), candidates.get(i));
        } catch (Exception ignored) { }
    }
    private double plateScore(Rect r) {
        double ratio = r.width / (double) r.height;
        return r.area() / (1.0 + Math.abs(ratio - 3.5));
    }
    public List<Mat> preprocess(Mat candidate) {
        Mat upper = new Mat(candidate, new Rect(0, 0, candidate.width(), Math.max(1, (int)(candidate.height() * .76)))).clone();
        Mat upperWithoutEmblem = upper.clone();
        Imgproc.rectangle(upperWithoutEmblem,
                new Point(upperWithoutEmblem.width() * .40, 0),
                new Point(upperWithoutEmblem.width() * .54, upperWithoutEmblem.height()),
                new Scalar(255, 255, 255), -1);
        Mat upperGray = new Mat(), upperLarge = new Mat(), upperEqual = new Mat();
        Imgproc.cvtColor(upper, upperGray, Imgproc.COLOR_BGR2GRAY);
        Imgproc.resize(upperGray, upperLarge, new Size(), 4, 4, Imgproc.INTER_CUBIC);
        Imgproc.equalizeHist(upperLarge, upperEqual);

        Mat gray = new Mat(), large = new Mat(), equal = new Mat(), otsu = new Mat(), adaptive = new Mat();
        Imgproc.cvtColor(candidate, gray, Imgproc.COLOR_BGR2GRAY); Imgproc.resize(gray, large, new Size(), 4, 4, Imgproc.INTER_CUBIC); Imgproc.equalizeHist(large, equal);
        Imgproc.threshold(equal, otsu, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);
        Imgproc.adaptiveThreshold(equal, adaptive, 255, Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C, Imgproc.THRESH_BINARY, 31, 11);
        return List.of(candidate.clone(), upperWithoutEmblem, upper, upperEqual, equal, otsu, adaptive);
    }
}
