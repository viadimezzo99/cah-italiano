#!/usr/bin/env python3
"""Prepara i brani della musica: taglia il silenzio, codifica in mp3 mono e misura la sonorità finale.

Uso:  python3 tools/music/prepare_tracks.py brano2.wav brano3.wav brano4.wav
      (i brani si numerano 2, 3, 4...: il primo è tools/music/menu-1.mp3, già presente)
Scrive:  tools/music/menu-N.mp3  e aggiorna tools/music/tracks.json (sonorità in LUFS di ogni brano).

Il livello non si cambia nel file: ogni brano si codifica una sola volta, dal WAV (nessuna doppia codifica).
L'equalizzazione si fa in riproduzione, da tools/audio.js, con la sonorità misurata qui: ogni brano arriva allo
stesso livello (MUSIC_TARGET_LUFS) qualunque sia il suo. Serve ffmpeg.
"""
import json, pathlib, re, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
# Nessun margine nel file: il lettore abbassa sempre ogni brano (mai sopra 1), quindi i picchi non arrivano mai a saturare l'uscita.
BITRATE = "80k"         # mono: più del doppio dei 48 kbit/s per canale del primo brano
FADE_IN, FADE_OUT = 0.04, 0.12


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def silence_edges(path, noise="-48dB", min_len=0.3):
    """Fine del silenzio iniziale e inizio di quello finale (secondi), se ci sono."""
    out = run(["ffmpeg", "-nostats", "-hide_banner", "-i", str(path), "-af", f"silencedetect=noise={noise}:d={min_len}", "-f", "null", "-"]).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)]).stdout)
    head = ends[0] if starts and starts[0] < 0.01 and ends else 0.0
    tail = starts[-1] if starts and (not ends or starts[-1] > ends[-1] if len(starts) > len(ends) else starts[-1] > dur - 1.5) else dur
    return head, min(tail, dur), dur


def lufs(path):
    out = run(["ffmpeg", "-nostats", "-hide_banner", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    m = re.search(r"Summary:.*?I:\s+(-?[\d.]+) LUFS", out, re.S)
    return round(float(m.group(1)), 1)


def main(wavs):
    manifest_path = HERE / "tracks.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    for i, wav in enumerate(wavs, start=2):
        wav = pathlib.Path(wav)
        head, tail, dur = silence_edges(wav)
        start = max(0.0, head - 0.05)
        end = min(dur, tail + 0.1)
        length = end - start
        target = HERE / f"menu-{i}.mp3"
        af = (f"atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS,"
              f"afade=t=in:d={FADE_IN},afade=t=out:st={length - FADE_OUT:.3f}:d={FADE_OUT}")
        r = run(["ffmpeg", "-y", "-nostats", "-hide_banner", "-i", str(wav), "-af", af, "-ac", "1", "-ar", "44100",
                 "-c:a", "libmp3lame", "-b:a", BITRATE, str(target)])
        if r.returncode != 0:
            sys.exit(r.stderr[-800:])
        level = lufs(target)
        manifest[f"menu-{i}"] = {"file": target.name, "lufs": level, "seconds": round(length, 1)}
        print(f"{wav.name}: taglio {start:.2f}-{end:.2f} s -> {target.name}  {level} LUFS  {target.stat().st_size // 1024} KB")
    # Anche i brani già presenti si misurano con lo stesso metodo, così i numeri del file sono sempre confrontabili.
    for name, fname in (("menu-1", "menu-1.mp3"), ("game", "game.mp3")):
        f = HERE / fname
        if f.exists():
            dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(f)]).stdout)
            manifest[name] = {"file": fname, "lufs": lufs(f), "seconds": round(dur, 1)}
    order = sorted(manifest, key=lambda k: (k == "game", k))
    manifest = {k: manifest[k] for k in order}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
