export type AudioMetrics = {
    volume: number;     // 0..1 (smoothed)
    bass: number;       // 0..1 (optional)
    mid: number;        // 0..1 (optional)
    treble: number;     // 0..1 (optional)
};

export function createAnalyser() {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    const data = new Uint8Array(analyser.frequencyBinCount);

    // simple helpers
    const metrics: AudioMetrics = { volume: 0, bass: 0, mid: 0, treble: 0 };

    function update() {
        analyser.getByteFrequencyData(data);

        // Compute volume as normalized average energy
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length; // 0..255
        const vol = avg / 255;

        // very simple band splits (tune later)
        const n = data.length;
        const b0 = Math.floor(n * 0.15);
        const b1 = Math.floor(n * 0.45);

        const bandAvg = (start: number, end: number) => {
            let s = 0;
            for (let i = start; i < end; i++) s += data[i];
            return (s / Math.max(1, end - start)) / 255;
        };

        const bass = bandAvg(0, b0);
        const mid = bandAvg(b0, b1);
        const treble = bandAvg(b1, n);

        // smoothing (simple EMA)
        const a = 0.15;
        metrics.volume = metrics.volume * (1 - a) + vol * a;
        metrics.bass = metrics.bass * (1 - a) + bass * a;
        metrics.mid = metrics.mid * (1 - a) + mid * a;
        metrics.treble = metrics.treble * (1 - a) + treble * a;

        return metrics;
    }

    return { ctx, analyser, metrics, update };
}
