import { Injectable } from '@angular/core';
import type { VoiceSettings } from './user.service';

export interface VoiceOption {
  name:     string;
  lang:     string;
  voiceURI: string;
  gender?:  'male' | 'female' | 'unknown';
}

/** Configuración TTS guardada por usuario en BD */
export interface TtsConfig {
  soundEnabled:  boolean;
  voiceName:     string;
  voiceLang:     string;
  voiceURI:      string;
  speechRate?:   number;
  speechPitch?:  number;
  speechVolume?: number;
}

const FEMALE_RE = /\b(female|mujer|femenino|femenina|Luc[ií]a|Mar[ií]a|Monica|M[oó]nica|Paulina|Conchita|Laura|Ana|Isabel|Carmen|Rosa|Elena|Nuria|Pilar|Raquel|Silvia|femenin)\b/i;
const MALE_RE   = /\b(male|hombre|masculino|Pablo|Jorge|Diego|Carlos|Antonio|Juan|Miguel|Manuel|Luis|Eduardo|Marcos|masculin|Albert[oa]|Sergio)\b/i;

@Injectable({ providedIn: 'root' })
export class TtsService {

  // ── Configuración de la sesión del usuario final ──────────────────────────
  // Se aplica a todas las páginas de la app (fuera del comunicador).

  private _soundEnabled  = false;
  private _voiceURI      = '';
  private _speechRate    = 0.9;
  private _speechPitch   = 1.0;
  private _speechVolume  = 1.0;
  private _gender        = '';

  /** Carga la configuración de voz del usuario actual. Llamar en user-session al cargar perfil. */
  setFromVoiceSettings(vs: VoiceSettings | null | undefined, gender = ''): void {
    if (!vs) { this._soundEnabled = false; this._gender = ''; return; }
    this._soundEnabled = vs.soundEnabled;
    this._gender       = gender;
    // Solo aplicar la voz del catálogo cuando el usuario está en modo catálogo.
    // En modo custom, TtsService no puede llamar al API de voz personalizada,
    // por lo que se limpia la URI y se usa la selección por género como fallback.
    if (vs.voiceMode === 'catalog' || !vs.voiceMode) {
      this._voiceURI     = vs.catalogVoice?.voiceURI     ?? '';
      this._speechRate   = vs.catalogVoice?.speechRate    ?? 0.9;
      this._speechPitch  = vs.catalogVoice?.speechPitch   ?? 1.0;
      this._speechVolume = vs.catalogVoice?.speechVolume  ?? 1.0;
    } else {
      // voiceMode === 'custom': usar fallback por género del navegador
      this._voiceURI     = '';
      this._speechRate   = 0.9;
      this._speechPitch  = 1.0;
      this._speechVolume = 1.0;
    }
  }

  /** Habla la etiqueta si el usuario tiene soundEnabled activado, usando su voz configurada. */
  speakIfEnabled(label: string): void {
    if (!this._soundEnabled || !label?.trim()) return;

    let voice: VoiceOption | undefined;

    if (this._voiceURI) {
      voice = { name: '', lang: 'es-ES', voiceURI: this._voiceURI };
    } else if (this._gender) {
      // Sin URI configurada: seleccionar voz por género del usuario
      const allVoices = window.speechSynthesis?.getVoices() ?? [];
      const opts: VoiceOption[] = allVoices.map(v => ({
        name: v.name, lang: v.lang, voiceURI: v.voiceURI,
        gender: this.detectVoiceGender(v),
      }));
      const found = this.getDefaultVoiceByUserGender(this._gender, opts);
      if (found) voice = found;
    }

    this.speak(label.trim().toLowerCase(), voice, this._speechRate, this._speechPitch, this._speechVolume);
  }

  /**
   * Intenta inferir el género de una voz a partir de su nombre y URI.
   * La Web Speech API no expone el género directamente, así que usamos
   * un patrón heurístico sobre el nombre.
   */
  detectVoiceGender(voice: SpeechSynthesisVoice): 'male' | 'female' | 'unknown' {
    const text = `${voice.name} ${voice.voiceURI}`;
    if (FEMALE_RE.test(text)) return 'female';
    if (MALE_RE.test(text))   return 'male';
    return 'unknown';
  }

  /**
   * Carga las voces disponibles en el dispositivo.
   * Maneja el caso asíncrono (onvoiceschanged) y un timeout de 3 s como fallback.
   */
  loadVoices(): Promise<VoiceOption[]> {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { resolve([]); return; }

      const toOption = (v: SpeechSynthesisVoice): VoiceOption => ({
        name:     v.name,
        lang:     v.lang,
        voiceURI: v.voiceURI,
        gender:   this.detectVoiceGender(v),
      });

      const current = window.speechSynthesis.getVoices();
      if (current.length > 0) { resolve(current.map(toOption)); return; }

      const timer = setTimeout(() => {
        window.speechSynthesis.onvoiceschanged = null;
        resolve(window.speechSynthesis.getVoices().map(toOption));
      }, 3000);

      window.speechSynthesis.onvoiceschanged = () => {
        clearTimeout(timer);
        window.speechSynthesis.onvoiceschanged = null;
        resolve(window.speechSynthesis.getVoices().map(toOption));
      };
    });
  }

  /**
   * Devuelve la voz más adecuada según el género del usuario:
   *   male/female → busca voz del mismo género en es-ES, luego cualquier es-*, luego global.
   *   other/prefer_not_to_say → primera voz es-ES o es-*, sin filtro de género.
   */
  getDefaultVoiceByUserGender(gender: string, voices: VoiceOption[]): VoiceOption | null {
    if (voices.length === 0) return null;

    const esES    = voices.filter(v => v.lang === 'es-ES');
    const spanish = voices.filter(v => v.lang.startsWith('es'));

    if (gender === 'male') {
      return (
        esES.find(v => v.gender === 'male')    ??
        spanish.find(v => v.gender === 'male') ??
        voices.find(v => v.gender === 'male')  ??
        esES[0] ?? spanish[0] ?? voices[0]
      );
    }

    if (gender === 'female') {
      return (
        esES.find(v => v.gender === 'female')    ??
        spanish.find(v => v.gender === 'female') ??
        voices.find(v => v.gender === 'female')  ??
        esES[0] ?? spanish[0] ?? voices[0]
      );
    }

    return esES[0] ?? spanish[0] ?? voices[0];
  }

  /** Pronuncia un texto con la voz y parámetros indicados. */
  speak(
    text:    string,
    voice?:  VoiceOption,
    rate     = 0.9,
    pitch    = 1.0,
    volume   = 1.0,
  ): void {
    if (!window.speechSynthesis || !text?.trim()) return;
    window.speechSynthesis.cancel();

    const utterance    = new SpeechSynthesisUtterance(text);
    utterance.lang     = voice?.lang ?? 'es-ES';
    utterance.rate     = rate;
    utterance.pitch    = pitch;
    utterance.volume   = volume;

    if (voice?.voiceURI) {
      const match = window.speechSynthesis.getVoices()
        .find(v => v.voiceURI === voice.voiceURI);
      if (match) utterance.voice = match;
    }

    // Delay tras cancel: evita el bug de Chrome donde cancel+speak
    // en la misma microtarea silencia o recorta el audio.
    setTimeout(() => window.speechSynthesis.speak(utterance), 50);
  }

  stop(): void {
    window.speechSynthesis?.cancel();
  }
}
