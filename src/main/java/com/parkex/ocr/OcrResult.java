package com.parkex.ocr;
public record OcrResult(String plate, double confidence) {
    public static OcrResult unreadable() { return new OcrResult("", 0); }
    public boolean readable(double threshold) { return plate != null && !plate.isBlank() && confidence >= threshold; }
}
