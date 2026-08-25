package com.parkex.ocr;
import org.opencv.core.*;
import org.opencv.imgproc.Imgproc;
import org.opencv.imgcodecs.Imgcodecs;
import java.nio.file.*;
import java.util.*;
public final class PlateDetector {
    /**
     * Cuantos recortes candidatos se le pasan al OCR y cuantas variantes de
     * preprocesado se prueban sobre cada uno. El producto de los dos es la
     * cuenta que manda: cada combinacion es una imagen mas para Tesseract, y
     * el costo crece lineal. Con 40 x 10 un solo cuadro tardaba mas de tres
     * minutos, que en la practica es lo mismo que estar colgado.
     */
    private static final int MAXIMO_CANDIDATOS = 6;

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
        // El rango de proporciones cubre la chapa Mercosur (400x130 mm, 3,1) y la
        // anterior uruguaya, mas angosta, y tolera la perspectiva de una camara
        // que no mira de frente.
        List<Mat> result = rectangles.stream().filter(r -> r.width >= 70 && r.height >= 18)
                .filter(r -> r.width / (double) r.height >= 1.6 && r.width / (double) r.height <= 6.5)
                .filter(r -> r.area() >= area * .002 && r.area() <= area * .20)
                .sorted(Comparator.comparingDouble(this::plateScore).reversed()).limit(MAXIMO_CANDIDATOS)
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

    /**
     * Seis variantes por candidato, no diez. Las que se fueron eran versiones
     * casi identicas de las que quedaron (la misma banda con y sin ecualizar) y
     * multiplicaban el tiempo de OCR sin aportar lecturas nuevas.
     *
     * Se prueban las dos bandas porque el recorte del detector casi nunca cae
     * justo sobre la chapa: si sobra paragolpes por abajo, los caracteres estan
     * arriba; si la chapa es Mercosur y el recorte es ajustado, arriba esta la
     * franja azul con URUGUAY y los caracteres estan abajo.
     */
    public List<Mat> preprocess(Mat candidate) {
        int w = candidate.width(), h = candidate.height();
        // El marco de la chapa y los tornillos aportan caracteres que no
        // existen (una "S" o una "W" pegadas al principio). Se recortan.
        int side = Math.max(1, (int) (w * .07));
        int inner = Math.max(1, w - 2 * side);

        int lowerY = (int) (h * .30);
        Mat lower = new Mat(candidate, new Rect(side, lowerY, inner, Math.max(1, h - lowerY))).clone();
        Mat lowerGray = new Mat(), lowerLarge = new Mat(), lowerOtsu = new Mat();
        Imgproc.cvtColor(lower, lowerGray, Imgproc.COLOR_BGR2GRAY);
        Imgproc.resize(lowerGray, lowerLarge, new Size(), 2, 2, Imgproc.INTER_CUBIC);
        Imgproc.threshold(lowerLarge, lowerOtsu, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);

        Mat upper = new Mat(candidate, new Rect(side, 0, inner, Math.max(1, (int) (h * .76)))).clone();
        Mat upperGray = new Mat(), upperLarge = new Mat(), upperOtsu = new Mat();
        Imgproc.cvtColor(upper, upperGray, Imgproc.COLOR_BGR2GRAY);
        Imgproc.resize(upperGray, upperLarge, new Size(), 3, 3, Imgproc.INTER_CUBIC);
        Imgproc.threshold(upperLarge, upperOtsu, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);

        // El recorte entero, por si la chapa es de una sola linea (formato
        // anterior al Mercosur) y las dos bandas la cortan por la mitad.
        Mat gray = new Mat(), large = new Mat(), equal = new Mat(), otsu = new Mat();
        Imgproc.cvtColor(candidate, gray, Imgproc.COLOR_BGR2GRAY);
        Imgproc.resize(gray, large, new Size(), 4, 4, Imgproc.INTER_CUBIC);
        Imgproc.equalizeHist(large, equal);
        Imgproc.threshold(equal, otsu, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);

        lower.release(); lowerGray.release(); upper.release(); upperGray.release();
        large.release();
        List<Mat> variantes = new ArrayList<>(List.of(lowerLarge, lowerOtsu, upperLarge, upperOtsu, equal, otsu));
        Mat ajustado = recortarAlBlancoDeLaChapa(candidate, gray);
        if (ajustado != null) variantes.add(ajustado);
        gray.release();
        return variantes;
    }

    /**
     * Ajusta el recorte al rectangulo blanco de la chapa.
     *
     * El detector rara vez acierta el borde exacto: al candidato le sobra
     * paragolpes, parrilla o sombra, y ese sobrante es lo que hace que
     * Tesseract no vea ninguna linea de texto. Binarizar por Otsu y quedarse
     * con la mancha clara mas grande devuelve casi siempre la chapa sola, que
     * es el unico recorte con el que Tesseract lee de forma confiable.
     */
    private Mat recortarAlBlancoDeLaChapa(Mat candidate, Mat gray) {
        Mat binary = new Mat(), hierarchy = new Mat();
        List<MatOfPoint> contours = new ArrayList<>();
        try {
            Imgproc.threshold(gray, binary, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);
            Imgproc.findContours(binary, contours, hierarchy, Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE);
            Rect mayor = contours.stream().map(Imgproc::boundingRect)
                    .max(Comparator.comparingDouble(Rect::area)).orElse(null);
            // Si la mancha mas grande es casi todo el candidato no ajusto nada,
            // y si es diminuta no es una chapa: en los dos casos no aporta.
            if (mayor == null || mayor.width < 40 || mayor.height < 12
                    || mayor.area() > candidate.width() * (double) candidate.height() * .92) return null;
            Mat recorte = new Mat(gray, mayor), ampliado = new Mat();
            Imgproc.resize(recorte, ampliado, new Size(), 4, 4, Imgproc.INTER_CUBIC);
            recorte.release();
            return ampliado;
        } finally { binary.release(); hierarchy.release(); contours.forEach(Mat::release); }
    }
}
