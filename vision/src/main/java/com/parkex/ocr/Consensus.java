package com.parkex.ocr;
import java.util.*;
import java.util.stream.Collectors;
public final class Consensus {
    public OcrResult choose(List<OcrResult> readings, int occurrences, double threshold) {
        List<OcrResult> valid=readings.stream().filter(r -> r.readable(Math.min(threshold,0.50))).toList();
        OcrResult exact=valid.stream().collect(Collectors.groupingBy(OcrResult::plate)).entrySet().stream()
                .filter(e -> e.getValue().size() >= Math.max(3, occurrences))
                .map(e -> {
                    double average=e.getValue().stream().mapToDouble(OcrResult::confidence).average().orElse(0);
                    double combined=1-Math.pow(1-average,e.getValue().size());
                    return new OcrResult(e.getKey(),combined);
                })
                .filter(r -> r.confidence() >= threshold)
                .max(Comparator.comparingDouble(OcrResult::confidence)).orElse(OcrResult.unreadable());
        if(!exact.plate().isEmpty()) return exact;

        List<OcrResult> sameLength=valid.stream().filter(r->r.plate().length()==7).toList();
        if(sameLength.size()<Math.max(3,occurrences)) return OcrResult.unreadable();
        StringBuilder voted=new StringBuilder(7); double agreement=0;
        for(int position=0;position<7;position++) {
            final int p=position;
            Map<Character,Long> counts=sameLength.stream().collect(Collectors.groupingBy(r->r.plate().charAt(p),Collectors.counting()));
            Map.Entry<Character,Long> winner=counts.entrySet().stream().max(Map.Entry.comparingByValue()).orElseThrow();
            voted.append(winner.getKey()); agreement+=winner.getValue()/(double)sameLength.size();
        }
        double confidence=agreement/7.0;
        return confidence>=threshold?new OcrResult(voted.toString(),confidence):OcrResult.unreadable();
    }
}
