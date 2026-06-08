"""
Microservicio FastAPI — OpenVoice V2
Clonar voz de referencia y sintetizar audio personalizado.

Requisitos previos (una sola vez):
  git clone https://github.com/myshell-ai/OpenVoice
  git clone https://github.com/myshell-ai/MeloTTS
  pip install -e ./OpenVoice -e ./MeloTTS
  python -m unidic download

  Descargar checkpoints:
    https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip
    Descomprimir en ./checkpoints_v2/
"""

import os
import sys
import hashlib
import tempfile
import traceback
from pathlib import Path

# ── Limitar threads ANTES de importar torch/numpy ────────────────────────────
# Por defecto PyTorch/OpenMP usan TODOS los núcleos de CPU, lo que satura el
# sistema e impide que el proceso Node.js (backend) responda con normalidad.
# Con 2 threads la síntesis sigue funcionando pero cede CPU al resto de procesos.
_CPU_THREADS = int(os.environ.get("VOICE_CPU_THREADS", "2"))
os.environ.setdefault("OMP_NUM_THREADS",     str(_CPU_THREADS))
os.environ.setdefault("MKL_NUM_THREADS",     str(_CPU_THREADS))
os.environ.setdefault("OPENBLAS_NUM_THREADS", str(_CPU_THREADS))
os.environ.setdefault("NUMEXPR_NUM_THREADS",  str(_CPU_THREADS))

import torch
import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR        = Path(__file__).parent
CHECKPOINTS_DIR = BASE_DIR / "checkpoints_v2"
VOICES_DIR      = BASE_DIR / "voices"
CACHE_DIR       = BASE_DIR / "cache"

VOICES_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[voice_service] Dispositivo: {DEVICE}")

# Aplicar límite de threads también vía PyTorch API (refuerza los env vars).
# Wrapped en try/except: uvicorn reimporta el módulo y el segundo intento
# lanza RuntimeError si los threads ya estaban iniciados.
if DEVICE == "cpu":
    try:
        torch.set_num_threads(_CPU_THREADS)
        torch.set_num_interop_threads(1)
        print(f"[voice_service] CPU threads limitados a {_CPU_THREADS} (VOICE_CPU_THREADS)")
    except RuntimeError:
        pass  # ya iniciados en importación previa; los env vars OMP/MKL siguen activos

# ── Cargar modelos al arranque ────────────────────────────────────────────────

try:
    sys.path.insert(0, str(BASE_DIR / "OpenVoice"))
    sys.path.insert(0, str(BASE_DIR / "MeloTTS"))

    from openvoice import se_extractor
    from openvoice.api import ToneColorConverter

    config_path = CHECKPOINTS_DIR / "converter" / "config.json"
    ckpt_path   = CHECKPOINTS_DIR / "converter" / "checkpoint.pth"

    tone_color_converter = ToneColorConverter(str(config_path), device=DEVICE, enable_watermark=False)
    tone_color_converter.load_ckpt(str(ckpt_path))

    from melo.api import TTS as MeloTTS
    tts_model = MeloTTS(language="ES", device=DEVICE)
    # spk2id puede ser un HParams (no dict) según la versión de MeloTTS
    _spk2id = tts_model.hps.data.spk2id
    _spk2id_dict = vars(_spk2id) if hasattr(_spk2id, '__dict__') and not isinstance(_spk2id, dict) else dict(_spk2id)
    ES_SPEAKER_ID = _spk2id_dict.get("ES", list(_spk2id_dict.values())[0])
    # Embedding del speaker base (español)
    base_speaker_se_path = CHECKPOINTS_DIR / "base_speakers" / "ses" / "es.pth"
    BASE_SE = torch.load(str(base_speaker_se_path), map_location=DEVICE)

    MODELS_READY = True
    print("[voice_service] Modelos cargados correctamente.")

except Exception as exc:
    MODELS_READY = False
    print(f"[voice_service] AVISO: No se pudieron cargar los modelos: {exc}")
    print("  Arranca el servicio de todos modos (los endpoints devolverán 503 si se llaman).")

# ── FastAPI ───────────────────────────────────────────────────────────────────

app = FastAPI(title="ISAAC Voice Service", version="1.0.0")


def require_models():
    if not MODELS_READY:
        raise HTTPException(
            status_code=503,
            detail="Modelos de voz no disponibles. Sigue las instrucciones de instalación en requirements.txt.",
        )


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateVoiceRequest(BaseModel):
    userId:             str
    referenceAudioPath: str


class SynthesizeRequest(BaseModel):
    userId:             str
    text:               str
    speakerProfilePath: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "modelsReady": MODELS_READY, "device": DEVICE}


@app.post("/voice/create")
def create_voice(body: CreateVoiceRequest):
    """
    Extrae el embedding tonal (tone color) de la muestra de referencia
    y lo guarda en disco. Devuelve la ruta del perfil.
    """
    require_models()

    ref_path = Path(body.referenceAudioPath)
    if not ref_path.exists():
        raise HTTPException(status_code=400, detail="Archivo de referencia no encontrado")

    user_voices_dir = VOICES_DIR / body.userId
    user_voices_dir.mkdir(parents=True, exist_ok=True)

    try:
        target_se, _ = se_extractor.get_se(
            str(ref_path),
            tone_color_converter,
            target_dir=str(user_voices_dir),
            vad=True,
        )
        profile_path = user_voices_dir / "speaker_embedding.pth"
        torch.save(target_se, str(profile_path))
        return {"speakerProfilePath": str(profile_path)}

    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error al crear perfil de voz: {exc}")


@app.post("/voice/synthesize")
def synthesize_voice(body: SynthesizeRequest):
    """
    Genera audio WAV aplicando el perfil de voz personalizado al texto dado.
    Devuelve el archivo de audio.
    """
    require_models()

    profile_path = Path(body.speakerProfilePath)
    if not profile_path.exists():
        raise HTTPException(status_code=400, detail="Perfil de voz no encontrado")

    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío")

    # Caché: mismo texto + mismo perfil = mismo audio
    cache_key  = hashlib.sha256(f"{body.userId}:{text}:{body.speakerProfilePath}".encode()).hexdigest()
    cache_file = CACHE_DIR / body.userId / f"{cache_key}.wav"
    cache_file.parent.mkdir(parents=True, exist_ok=True)

    if cache_file.exists():
        return FileResponse(str(cache_file), media_type="audio/wav")

    try:
        # 1. TTS base con MeloTTS (español)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name

        print(f"[synthesize] texto ({len(text)} chars): {text!r}")
        print(f"[synthesize] ES_SPEAKER_ID={ES_SPEAKER_ID}")
        tts_model.tts_to_file(text, ES_SPEAKER_ID, tmp_path, speed=1.0)

        # Diagnóstico: duración del TTS base
        import wave as _wave
        with _wave.open(tmp_path) as _wf:
            _dur = _wf.getnframes() / _wf.getframerate()
        print(f"[synthesize] MeloTTS duración: {_dur:.2f} s  ({os.path.getsize(tmp_path)} bytes)")

        # 2. Conversión de color tonal (aplicar voz del usuario)
        target_se = torch.load(str(profile_path), map_location=DEVICE)

        tone_color_converter.convert(
            audio_src_path=tmp_path,
            src_se=BASE_SE,
            tgt_se=target_se,
            output_path=str(cache_file),
        )

        os.unlink(tmp_path)

        return FileResponse(str(cache_file), media_type="audio/wav")

    except Exception as exc:
        traceback.print_exc()
        # Limpiar archivo temporal si existe
        try:
            if "tmp_path" in locals() and os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Error al sintetizar voz: {exc}")


# ── Arranque ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    # En Render, $PORT se inyecta como variable de entorno. Localmente usa 8000.
    _port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=_port, reload=False)
