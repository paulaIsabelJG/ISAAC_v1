import { Component, OnInit, OnDestroy } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { AuthService, AddressSuggestion } from '../../services/auth.service';
import { UserService, UpdateUserPayload, SelfPermissions, VoiceSettings, CatalogVoice, FrequentLocation, AddLocationPayload } from '../../services/user.service';
import { TtsService, VoiceOption } from '../../services/tts.service';
import { VoiceService } from '../../services/voice.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';
import { environment } from '../../../environments/environment';

const MAX_IMG = 2 * 1024 * 1024; // 2 MB

/** Contraseña: válida si está vacía O si tiene ≥6 caracteres */
const passwordOptional: ValidatorFn = (c: AbstractControl) => {
  const v = c.value as string;
  if (!v || v.length === 0) return null;
  return v.length >= 6 ? null : { minlength: true };
};

@Component({
  selector: 'app-user-final-form',
  templateUrl: './user-final-form.page.html',
  // Reutiliza los estilos visuales de add-user + override mínimo propio
  styleUrls: ['../add-user/add-user.page.scss', './user-final-form.page.scss'],
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, IonicModule, LoadingErrorStateComponent, AppPageHeaderComponent],
})
export class UserFinalFormPage implements OnInit, OnDestroy {

  userId = '';
  returnTo = '/add-user';

  /** true → PATCH sobre usuario existente; false → registro nuevo */
  get isEditMode(): boolean { return this.userId !== 'new'; }

  get pageTitle(): string { return this.isEditMode ? 'Datos personales' : 'Nuevo usuario final'; }

  form!: FormGroup;

  // ── Imagen ───────────────────────────────────────────────────────────────────
  imgB64: string | null = null;
  imgUrl: SafeUrl | null = null;
  private _originalImgB64: string | null = null;
  _extraDirty = false;

  // ── Toggle contraseña ────────────────────────────────────────────────────────
  showPwd = false;

  // ── Sonido + voz (catálogo) ──────────────────────────────────────────────────
  soundEnabled      = false;
  voices:           VoiceOption[] = [];
  selectedVoiceURI  = '';
  voicesLoading     = false;
  voicesError       = '';

  // ── Modo de voz ───────────────────────────────────────────────────────────────
  voiceMode: 'catalog' | 'custom' = 'catalog';

  // ── Grabación / estado de voz personalizada ───────────────────────────────────
  customVoiceConsent  = false;
  customVoiceStep:    'idle' | 'recording' | 'recorded' | 'mic_error' | 'creating' | 'processing' | 'ready' | 'error' = 'idle';
  customVoiceError    = '';
  customVoiceTesting  = false;
  recordedAudioUrl:   string | null = null;

  // ID temporal cuando el usuario es pre-registrado durante la creación de voz (modo creación)
  preRegisteredUserId: string | null = null;

  // Polling de estado de voz
  readonly MAX_POLLING_ATTEMPTS = 40;
  voicePollingAttempts = 0;
  private voicePollingInterval: ReturnType<typeof setInterval> | null = null;

  private recordedBlob:   Blob | null = null;
  private mediaRec:       MediaRecorder | null = null;
  private audioChunks:    Blob[] = [];
  private activeStream:   MediaStream | null = null;
  private savedVoiceURI   = '';
  private _audioCtx:      AudioContext | null = null;

  /** Progreso estimado del polling (0–1), máx 95 % hasta que Python confirme */
  get voiceProcessingProgress(): number {
    return Math.min(this.voicePollingAttempts / this.MAX_POLLING_ATTEMPTS, 0.95);
  }

  /**
   * Bloquea Guardar solo durante operaciones activas iniciadas en ESTA sesión.
   * 'processing' NO bloquea: Python trabaja en background y el usuario
   * puede guardar el resto de datos mientras tanto.
   */
  get saveDisabledByVoice(): boolean {
    if (this.voiceMode !== 'custom') return false;
    return ['recording', 'recorded', 'creating'].includes(this.customVoiceStep);
  }

  // ── Permisos del usuario final ───────────────────────────────────────────────
  perms = {
    editData:           false,
    editBoards:         false,
    editStats:          false,
    addPictograms:      false,
    assignProfessionals: false,
    assignFamilies:     false,
  };

  // ── Lugares frecuentes ────────────────────────────────────────────────────────
  locations:           FrequentLocation[] = [];
  locationsLoading     = false;
  showAddLocation      = false;
  editingLocationId:   string | null = null;
  locationForm = { name: '', address: '', photoUrl: '', radiusMeters: 150 };
  locationSaving       = false;

  // ── Autocompletado de dirección del formulario de lugar ─────────────────────
  locSuggestions:    AddressSuggestion[] = [];
  showLocSuggestions = false;
  private _deb:      ReturnType<typeof setTimeout> | null = null;

  // ── Fecha límite para el selector de nacimiento ──────────────────────────────
  readonly today = new Date().toISOString().substring(0, 10);

  // ── Estados ──────────────────────────────────────────────────────────────────
  isLoading = true;
  isSaving  = false;
  loadError = '';

  constructor(
    private route:      ActivatedRoute,
    private router:     Router,
    private fb:         FormBuilder,
    private authSvc:    AuthService,
    private userSvc:    UserService,
    private voiceSvc:   VoiceService,
    private ttsSvc:     TtsService,
    private toastCtrl:  ToastController,
    private alertCtrl:  AlertController,
    private sanitizer:  DomSanitizer,
  ) {}

  ngOnDestroy(): void {
    if (this.voicePollingInterval) { clearInterval(this.voicePollingInterval); this.voicePollingInterval = null; }
    this.ttsSvc.stop();
    this.mediaRec?.stop();
    this.activeStream?.getTracks().forEach(t => t.stop());
    if (this.recordedAudioUrl) URL.revokeObjectURL(this.recordedAudioUrl);
    if (this._audioCtx) { this._audioCtx.close().catch(() => {}); this._audioCtx = null; }
  }

  // ── AudioContext para reproducción de voz personalizada ──────────────────────

  /** Crea/devuelve el AudioContext y lo desbloquea. Llamar dentro del gesto del usuario. */
  private _getAudioCtx(): AudioContext | null {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      if (!this._audioCtx || this._audioCtx.state === 'closed') {
        this._audioCtx = new AC() as AudioContext;
      }
      if (this._audioCtx.state === 'suspended') this._audioCtx.resume().catch(() => {});
      return this._audioCtx;
    } catch { return null; }
  }

  /** Reproduce un Blob de audio usando AudioContext (sin restricción de autoplay). */
  private async _playBlob(blob: Blob, ctx: AudioContext | null): Promise<void> {
    if (!ctx) { console.warn('[VoiceTest] _playBlob: ctx is null, skipping'); return; }
    console.log('[VoiceTest] ctx.state before resume:', ctx.state);
    if (ctx.state === 'suspended') await ctx.resume();
    console.log('[VoiceTest] ctx.state after resume:', ctx.state, '| blob size:', blob.size, 'bytes');
    const buf         = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buf);
    console.log('[VoiceTest] audioBuffer duration:', audioBuffer.duration, 's | sampleRate:', audioBuffer.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (reason: string) => { if (!done) { done = true; console.log('[VoiceTest] finished:', reason); resolve(); } };
      src.onended = () => finish('onended');
      src.start(0);
      console.log('[VoiceTest] source.start(0) called — ctx.state:', ctx.state, 'currentTime:', ctx.currentTime);
      setTimeout(() => finish('timeout'), Math.max((audioBuffer.duration + 1) * 1000, 5000));
    });
  }

  ngOnInit() {
    this.userId   = this.route.snapshot.paramMap.get('userId') ?? '';
    this.returnTo = this.route.snapshot.queryParamMap.get('returnTo') ?? '/add-user';

    // En creación la contraseña es obligatoria; en edición es opcional
    const pwdValidators = this.isEditMode
      ? [passwordOptional]
      : [Validators.required, Validators.minLength(6)];

    this.form = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', pwdValidators],
      name:     ['', [Validators.required, Validators.minLength(2)]],
      surname:  ['', Validators.required],
      birthDate: [''],
      gender:   ['prefer_not_to_say'],
    });
  }

  ionViewWillEnter() {
    if (this.isEditMode && this.isLoading) {
      this.loadUser();
    } else if (!this.isEditMode) {
      this.isLoading = false;
      void this.loadVoicesForGender(null);
    }
  }

  // ── Carga del usuario existente ───────────────────────────────────────────────

  private async loadUser(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';

    try {
      const res = await firstValueFrom(this.userSvc.getUserById(this.userId));
      const u = res.user;

      const name    = u.name    ?? '';
      const surname = u.surname ?? '';

      this.form.patchValue({
        email:   u.email,
        name,
        surname,
        gender:    u.gender ?? 'prefer_not_to_say',
        birthDate: u.birthDate ? (u.birthDate as string).substring(0, 10) : '',
        // password vacío → no cambia
      });

      if (u.image) {
        this.imgB64 = u.image;
        this.imgUrl = this.buildSafeUrl(u.image);
      }
      this._originalImgB64 = this.imgB64;
      this._extraDirty = false;

      // Precargar selfPermissions en los checkboxes
      const sp = u.selfPermissions;
      this.perms = {
        editData:            sp?.canEditPersonalData    ?? false,
        editBoards:          sp?.canEditBoards          ?? false,
        editStats:           sp?.canViewStats           ?? false,
        addPictograms:       sp?.canAddPictograms       ?? false,
        assignProfessionals: sp?.canAssignProfessionals ?? false,
        assignFamilies:      sp?.canAssignFamilies      ?? false,
      };

      // Precargar voiceSettings
      const vs = u.voiceSettings;
      if (vs) {
        this.soundEnabled = vs.soundEnabled ?? false;
        this.voiceMode    = vs.voiceMode    ?? 'catalog';
        if (vs.catalogVoice?.voiceURI) {
          this.savedVoiceURI = vs.catalogVoice.voiceURI;
        }
        const cv = vs.customVoice;
        if (cv) {
          this.customVoiceStep = cv.status === 'ready'           ? 'ready'
                               : cv.status === 'processing'      ? 'processing'
                               : cv.status === 'sample_uploaded' ? 'idle'
                               : cv.status === 'error'           ? 'error'
                               : 'idle';
          if (cv.status === 'error' && cv.lastError) {
            this.customVoiceError = cv.lastError;
          }
          if (cv.consentAccepted) this.customVoiceConsent = true;
          // Si la voz estaba procesándose, arrancar polling para detectar cuando termine
          if (cv.status === 'processing') {
            this.voicePollingAttempts = 0;
            this.startVoicePolling(this.userId);
          }
        }
      }
      // Cargar voces siempre (el selector está siempre visible)
      void this.loadVoicesForGender(u.gender);

      // Cargar lugares frecuentes (no bloquea si falla)
      void this.loadLocations();
    } catch {
      this.loadError = 'Error al cargar los datos del usuario.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Voz: carga de voces disponibles ─────────────────────────────────────────

  async loadVoicesForGender(gender?: string | null): Promise<void> {
    this.voicesLoading = true;
    this.voicesError   = '';
    try {
      const all     = await this.ttsSvc.loadVoices();
      const esES    = all.filter(v => v.lang === 'es-ES');
      const spanish = all.filter(v => v.lang.startsWith('es'));
      this.voices   = esES.length > 0 ? esES : spanish.length > 0 ? spanish : all;

      if (this.voices.length === 0) {
        this.voicesError = 'No hay voces de síntesis disponibles en este dispositivo.';
        return;
      }
      // Si ya hay una URI guardada en BD, la seleccionamos; si no, la del género
      if (this.savedVoiceURI && this.voices.some(v => v.voiceURI === this.savedVoiceURI)) {
        this.selectedVoiceURI = this.savedVoiceURI;
      } else {
        const def = this.ttsSvc.getDefaultVoiceByUserGender(gender ?? 'prefer_not_to_say', this.voices);
        if (def) this.selectedVoiceURI = def.voiceURI;
      }
    } catch {
      this.voicesError = 'Error al cargar las voces del dispositivo.';
    } finally {
      this.voicesLoading = false;
    }
  }

  onVoiceChange(event: Event): void {
    this.selectedVoiceURI = (event.target as HTMLSelectElement).value;
    this._extraDirty = true;
  }

  testVoice(voice: VoiceOption): void {
    const name = (this.form.get('name')?.value as string)?.trim();
    const text = name ? `Hola, me llamo ${name}, ¿qué tal estás?` : 'Hola, ¿qué tal estás?';
    this.ttsSvc.speak(text, voice);
  }

  setVoiceMode(mode: 'catalog' | 'custom'): void {
    this.voiceMode = mode;
    this._extraDirty = true;
    if (mode === 'catalog' && this.voices.length === 0 && !this.voicesLoading) {
      void this.loadVoicesForGender(this.form.get('gender')?.value);
    }
  }

  async toggleSound(): Promise<void> {
    this.soundEnabled = !this.soundEnabled;
    this._extraDirty = true;
    if (this.soundEnabled && this.voices.length === 0) {
      await this.loadVoicesForGender(this.form.get('gender')?.value);
    }
    if (!this.soundEnabled) this.ttsSvc.stop();
  }

  // ── Grabación de muestra de voz ──────────────────────────────────────────────

  async startRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.customVoiceStep  = 'mic_error';
      this.customVoiceError = 'Tu navegador no soporta grabación de audio.';
      return;
    }
    try {
      this.activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.customVoiceStep  = 'mic_error';
      this.customVoiceError = 'No se pudo acceder al micrófono. Comprueba los permisos del navegador.';
      return;
    }
    this.audioChunks = [];
    const mimeType   = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
    this.mediaRec    = new MediaRecorder(this.activeStream, { mimeType });
    this.mediaRec.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };
    this.mediaRec.onstop = () => {
      this.recordedBlob    = new Blob(this.audioChunks, { type: mimeType });
      if (this.recordedAudioUrl) URL.revokeObjectURL(this.recordedAudioUrl);
      this.recordedAudioUrl = URL.createObjectURL(this.recordedBlob);
      this.activeStream?.getTracks().forEach(t => t.stop());
      this.activeStream    = null;
      this.customVoiceStep = 'recorded';
    };
    this.mediaRec.start();
    this.customVoiceStep = 'recording';
  }

  stopRecording(): void { this.mediaRec?.stop(); }

  discardRecording(): void {
    if (this.recordedAudioUrl) { URL.revokeObjectURL(this.recordedAudioUrl); this.recordedAudioUrl = null; }
    this.recordedBlob     = null;
    this.audioChunks      = [];
    this.customVoiceStep  = 'idle';
    this.customVoiceError = '';
  }

  // ── Crear voz dentro del formulario ──────────────────────────────────────────

  async createCustomVoiceInForm(): Promise<void> {
    if (!this.recordedBlob || !this.customVoiceConsent) return;

    this.customVoiceError = '';
    this.customVoiceStep  = 'creating';

    try {
      let targetUserId: string;

      if (this.isEditMode) {
        targetUserId = this.userId;
      } else {
        if (!this.preRegisteredUserId) {
          // Validar campos obligatorios antes de pre-registrar
          ['email', 'password', 'name', 'surname'].forEach(c => this.form.get(c)?.markAsTouched());
          const hasInvalid = ['email', 'password', 'name', 'surname']
            .some(c => this.form.get(c)?.invalid);
          if (hasInvalid) {
            this.customVoiceStep  = 'recorded';
            this.customVoiceError = 'Rellena Email, Contraseña, Nombre y Apellidos antes de crear la voz.';
            return;
          }

          const { email, password, name, surname, gender } = this.form.value;
          const org = this.authSvc.getCurrentUser();
          const regRes = await firstValueFrom(this.authSvc.register({
            email:    email.trim(),
            password: password.trim(),
            name:     [name?.trim(), surname?.trim()].filter(Boolean).join(' '),
            type:     'user',
            gender:   gender || 'prefer_not_to_say',
            centro:   org?.centro || 'Centro ISAAC',
          }));
          this.preRegisteredUserId = regRes.user.id;
        }
        targetUserId = this.preRegisteredUserId;
      }

      const audioDataUrl = await this.blobToBase64(this.recordedBlob);
      await firstValueFrom(this.voiceSvc.uploadSample(
        targetUserId, audioDataUrl, true,
        'Confirmo que tengo permiso para crear una voz sintética a partir de esta grabación y entiendo que se usará para generar mensajes de voz dentro de esta aplicación.',
      ));

      await firstValueFrom(this.voiceSvc.createVoice(targetUserId));

      this.customVoiceStep      = 'processing';
      this.voicePollingAttempts = 0;
      this.startVoicePolling(targetUserId);

    } catch (err: any) {
      this.customVoiceStep  = 'error';
      this.customVoiceError = err?.error?.error || 'Error al procesar la muestra de voz';
    }
  }

  private startVoicePolling(userId: string): void {
    if (this.voicePollingInterval) clearInterval(this.voicePollingInterval);

    this.voicePollingInterval = setInterval(async () => {
      this.voicePollingAttempts++;

      if (this.voicePollingAttempts > this.MAX_POLLING_ATTEMPTS) {
        clearInterval(this.voicePollingInterval!);
        this.voicePollingInterval = null;
        this.customVoiceStep  = 'error';
        this.customVoiceError = 'El procesamiento tardó demasiado. Puedes guardar igualmente y la voz se activará cuando el servidor termine.';
        return;
      }

      try {
        const res    = await firstValueFrom(this.voiceSvc.getStatus(userId));
        const status = res.voiceSettings?.customVoice?.status;

        if (status === 'ready') {
          clearInterval(this.voicePollingInterval!);
          this.voicePollingInterval = null;
          this.customVoiceStep = 'ready';
          this.autoPlayTestVoice(userId);
        } else if (status === 'error') {
          clearInterval(this.voicePollingInterval!);
          this.voicePollingInterval = null;
          this.customVoiceStep  = 'error';
          this.customVoiceError = res.voiceSettings?.customVoice?.lastError
            || 'Error al crear la voz';
        }
      } catch { /* ignorar errores transitorios de red durante el polling */ }
    }, 3000);
  }

  private async autoPlayTestVoice(userId: string): Promise<void> {
    try {
      const blob = await firstValueFrom(
        this.voiceSvc.generateAudio(userId, 'Tu voz personalizada está lista. Así es como sonaré en la aplicación.')
      );
      // Reutiliza el AudioContext si ya fue desbloqueado por un gesto previo del usuario.
      // Si no hay contexto (la voz terminó por polling sin interacción), no reproducir.
      const ctx = this._audioCtx && this._audioCtx.state !== 'closed' ? this._audioCtx : null;
      await this._playBlob(blob, ctx);
    } catch { /* si Python no está activo o autoplay bloqueado, no reproducir */ }
  }

  async testCustomVoice(): Promise<void> {
    const targetId = this.isEditMode ? this.userId : this.preRegisteredUserId;
    if (!targetId) return;
    this.customVoiceTesting = true;

    // AudioContext debe crearse dentro del gesto de usuario (antes del primer await)
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    let audioCtx: AudioContext | null = null;
    try { audioCtx = new AC(); } catch { /* navegador sin AudioContext */ }

    const token   = this.authSvc.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const body = JSON.stringify({
      userId: targetId,
      text:   'Hola, esta es mi voz para comunicarme con esta aplicación.',
    });

    // Auto-retry: la primera petición puede disparar la síntesis en Python y
    // expirar en el gateway; las siguientes ya encuentran el resultado en caché.
    const MAX_ATTEMPTS = 4;
    const RETRY_DELAY_MS = 10_000;
    let arrayBuffer: ArrayBuffer | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await fetch(`${environment.apiUrl}/voice/tts/speak`, {
          method: 'POST', headers, body,
        });
        if (resp.ok) {
          arrayBuffer = await resp.arrayBuffer();
          break;
        }
        // 504 = gateway timeout: Python está sintetizando, reintentamos
        if (resp.status === 504 && attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error(`HTTP ${resp.status}`);
      } catch (fetchErr: any) {
        // Error de red también puede indicar síntesis en curso
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        } else {
          throw fetchErr;
        }
      }
    }

    try {
      if (!arrayBuffer) throw new Error('No se recibió audio tras varios intentos');
      if (!audioCtx)    throw new Error('AudioContext no disponible en este navegador');

      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        source.onended = finish;
        source.start(0);
        setTimeout(finish, Math.max((audioBuffer.duration + 2) * 1000, 8000));
      });

    } catch (err) {
      console.error('[VoiceTest] error:', err);
      (await this.toastCtrl.create({
        message: 'No se pudo reproducir la voz. Comprueba que el servicio de síntesis esté activo.',
        duration: 4000, color: 'warning', position: 'top',
      })).present();
    } finally {
      audioCtx?.close().catch(() => {});
      this.customVoiceTesting = false;
    }
  }

  async deleteCustomVoice(): Promise<void> {
    try {
      await firstValueFrom(this.voiceSvc.deleteCustomVoice(this.userId));
      this.voiceMode       = 'catalog';
      this.customVoiceStep = 'idle';
      this.customVoiceConsent = false;
      this.discardRecording();
      (await this.toastCtrl.create({
        message: 'Voz personalizada eliminada. Ahora se usará la voz del catálogo.',
        duration: 2500, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al eliminar la voz personalizada.',
        duration: 2500, color: 'danger', position: 'top',
      })).present();
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader   = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── Imagen ───────────────────────────────────────────────────────────────────

  pickImage() {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';

    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (file.size > MAX_IMG) {
        (await this.toastCtrl.create({
          message: 'La imagen supera 2 MB', duration: 2500,
          color: 'warning', position: 'top',
        })).present();
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const b64   = ev.target!.result as string;
        this.imgB64 = b64;
        this.imgUrl = this.sanitizer.bypassSecurityTrustUrl(b64);
      };
      reader.readAsDataURL(file);
    };

    input.click();
  }

  // ── Lugares frecuentes ────────────────────────────────────────────────────────

  async loadLocations(): Promise<void> {
    if (!this.isEditMode) return;
    this.locationsLoading = true;
    try {
      const res = await firstValueFrom(this.userSvc.getLocations(this.userId));
      this.locations = res.locations ?? [];
    } catch { /* silencioso */ } finally {
      this.locationsLoading = false;
    }
  }

  openAddLocation(): void {
    this.editingLocationId  = null;
    this.locationForm       = { name: '', address: '', photoUrl: '', radiusMeters: 150 };
    this.locSuggestions     = [];
    this.showLocSuggestions = false;
    this.showAddLocation    = true;
  }

  openEditLocation(loc: FrequentLocation): void {
    this.editingLocationId  = loc._id;
    this.locationForm       = {
      name:         loc.name,
      address:      loc.address  ?? '',
      photoUrl:     loc.photoUrl ?? '',
      radiusMeters: loc.radiusMeters ?? 150,
    };
    this.locSuggestions     = [];
    this.showLocSuggestions = false;
    this.showAddLocation    = true;
  }

  cancelLocationForm(): void {
    this.showAddLocation    = false;
    this.editingLocationId  = null;
    this.locSuggestions     = [];
    this.showLocSuggestions = false;
  }

  async saveLocation(): Promise<void> {
    if (!this.locationForm.name.trim()) {
      (await this.toastCtrl.create({
        message: 'El nombre del lugar es obligatorio', duration: 2000,
        color: 'warning', position: 'top',
      })).present();
      return;
    }

    // En modo creación: acumular localmente; se enviarán a la API al guardar el usuario.
    if (!this.isEditMode) {
      if (this.editingLocationId) {
        const idx = this.locations.findIndex(l => l._id === this.editingLocationId);
        if (idx >= 0) {
          this.locations[idx] = {
            ...this.locations[idx],
            name:         this.locationForm.name.trim(),
            address:      this.locationForm.address.trim() || null,
            photoUrl:     this.locationForm.photoUrl.trim() || null,
            radiusMeters: this.locationForm.radiusMeters || 150,
          };
        }
      } else {
        this.locations.push({
          _id:          'tmp_' + Date.now(),
          name:         this.locationForm.name.trim(),
          address:      this.locationForm.address.trim() || null,
          photoUrl:     this.locationForm.photoUrl.trim() || null,
          radiusMeters: this.locationForm.radiusMeters || 150,
          enabled:      true,
        });
      }
      this.showAddLocation   = false;
      this.editingLocationId = null;
      return;
    }

    // En modo edición: llamar a la API directamente.
    this.locationSaving = true;
    const payload: AddLocationPayload = {
      name:         this.locationForm.name.trim(),
      address:      this.locationForm.address.trim() || null,
      photoUrl:     this.locationForm.photoUrl.trim() || null,
      radiusMeters: this.locationForm.radiusMeters || 150,
    };

    try {
      if (this.editingLocationId) {
        const res = await firstValueFrom(
          this.userSvc.updateLocation(this.userId, this.editingLocationId, payload),
        );
        const idx = this.locations.findIndex(l => l._id === this.editingLocationId);
        if (idx >= 0) this.locations[idx] = res.location;
      } else {
        const res = await firstValueFrom(this.userSvc.addLocation(this.userId, payload));
        this.locations.push(res.location);
      }
      this.showAddLocation   = false;
      this.editingLocationId = null;
      (await this.toastCtrl.create({
        message: 'Lugar guardado', duration: 2000, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al guardar el lugar', duration: 2500, color: 'danger', position: 'top',
      })).present();
    } finally {
      this.locationSaving = false;
    }
  }

  async deleteLocation(loc: FrequentLocation): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar lugar',
      message: `¿Eliminar "${loc.name}"?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar', role: 'destructive',
          handler: async () => {
            // En modo creación: eliminar solo del array local.
            if (!this.isEditMode) {
              this.locations = this.locations.filter(l => l._id !== loc._id);
              return;
            }
            try {
              await firstValueFrom(this.userSvc.deleteLocation(this.userId, loc._id));
              this.locations = this.locations.filter(l => l._id !== loc._id);
            } catch {
              (await this.toastCtrl.create({
                message: 'Error al eliminar el lugar', duration: 2500, color: 'danger', position: 'top',
              })).present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Autocompletado de dirección del formulario de lugar ─────────────────────

  onLocAddressInput(e: Event): void {
    const val = (e.target as HTMLInputElement).value;
    if (this._deb) clearTimeout(this._deb);
    if (val.length < 3) { this.locSuggestions = []; this.showLocSuggestions = false; return; }
    this._deb = setTimeout(() => {
      this.authSvc.getPlaceSuggestions(val).subscribe({
        next: (r) => {
          const seen = new Set<string>();
          this.locSuggestions = r.suggestions.filter(s => {
            if (seen.has(s.formattedAddress)) return false;
            seen.add(s.formattedAddress);
            return true;
          });
          this.showLocSuggestions = this.locSuggestions.length > 0;
        },
        error: () => { this.locSuggestions = []; this.showLocSuggestions = false; },
      });
    }, 300);
  }

  selectLocSuggestion(s: AddressSuggestion): void {
    this.locationForm.address = s.formattedAddress;
    this.locSuggestions       = [];
    this.showLocSuggestions   = false;
  }

  closeLocSuggestions(): void { setTimeout(() => { this.showLocSuggestions = false; }, 150); }

  // ── Guardar ──────────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    this.ttsSvc.speakIfEnabled('guardar');
    console.log('[DEBUG save] INICIO — form.invalid:', this.form.invalid, '| form.value:', this.form.value);
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.isSaving = true;

    const { email, password, name, surname, gender, birthDate } = this.form.value;
    const trimName      = name?.trim()    ?? '';
    const trimSurname   = surname?.trim() ?? '';
    const birthDateValue = birthDate && birthDate.trim() ? birthDate.trim() : null;

    const selfPerms: SelfPermissions = {
      canEditPersonalData:    this.perms.editData,
      canEditBoards:          this.perms.editBoards,
      canViewStats:           this.perms.editStats,
      canAddPictograms:       this.perms.addPictograms,
      canAssignProfessionals: this.perms.assignProfessionals,
      canAssignFamilies:      this.perms.assignFamilies,
    };

    const voice = this.voices.find(v => v.voiceURI === this.selectedVoiceURI) ?? null;
    const catalogVoice: CatalogVoice = {
      voiceName: voice?.name     ?? '',
      voiceLang: voice?.lang     ?? 'es-ES',
      voiceURI:  voice?.voiceURI ?? '',
    };
    const vs: VoiceSettings = {
      soundEnabled: this.soundEnabled,
      voiceMode:    this.voiceMode,
      catalogVoice,
    };

    try {
      let targetUserId: string;

      if (!this.isEditMode) {
        // ── CREAR ─────────────────────────────────────────────────────────
        if (this.preRegisteredUserId) {
          targetUserId = this.preRegisteredUserId;
          const payload: UpdateUserPayload = {
            name:            trimName,
            surname:         trimSurname,
            email:           email?.trim(),
            gender:          gender || 'prefer_not_to_say',
            birthDate:       birthDateValue,
            image:           this.imgB64 ?? undefined,
            selfPermissions: selfPerms,
            voiceSettings:   vs,
          };
          await firstValueFrom(this.userSvc.updateUserById(targetUserId, payload));
        } else {
          // Registro normal (catálogo o no se creó voz todavía)
          const org = this.authSvc.getCurrentUser();
          const regRes = await firstValueFrom(
            this.authSvc.register({
              email:    email.trim(),
              password: password.trim(),
              name:     [trimName, trimSurname].filter(Boolean).join(' '),
              type:     'user',
              gender:   gender || 'prefer_not_to_say',
              centro:   org?.centro || 'Centro ISAAC',
              image:    this.imgB64 ?? undefined,
            })
          );
          targetUserId = regRes.user.id;

          // Patch para guardar name/surname por separado, además de birthDate, permisos y voz
          const patch: UpdateUserPayload = {
            name:            trimName,
            surname:         trimSurname,
            birthDate:       birthDateValue,
            selfPermissions: selfPerms,
            voiceSettings:   vs,
          };
          await firstValueFrom(this.userSvc.updateUserById(targetUserId, patch));
        }

        // Guardar lugares frecuentes capturados durante la creación (silencioso si falla)
        for (const loc of this.locations) {
          try {
            await firstValueFrom(this.userSvc.addLocation(targetUserId, {
              name:         loc.name,
              address:      loc.address ?? null,
              photoUrl:     loc.photoUrl ?? null,
              radiusMeters: loc.radiusMeters ?? 150,
            }));
          } catch { /* el logopeda puede añadirlos después desde el perfil */ }
        }

      } else {
        // ── EDITAR ────────────────────────────────────────────────────────
        targetUserId = this.userId;
        const payload: UpdateUserPayload = {
          name:            trimName,
          surname:         trimSurname,
          email:           email?.trim(),
          gender:          gender || 'prefer_not_to_say',
          birthDate:       birthDateValue,
          image:           this.imgB64 ?? undefined,
          selfPermissions: selfPerms,
          voiceSettings:   vs,
        };
        if (password && password.trim().length >= 6) {
          payload.password = password.trim();
        }
        await firstValueFrom(this.userSvc.updateUserById(targetUserId, payload));
      }

      const toastMsg = this.isEditMode ? '✓ Datos actualizados correctamente' : '✓ Usuario añadido';

      (await this.toastCtrl.create({
        message: toastMsg, duration: 2800, color: 'success', position: 'top',
      })).present();

      this.router.navigate(['/user-session', targetUserId]);

    } catch (err: any) {
      (await this.toastCtrl.create({
        message: err?.error?.error || 'Error al guardar los datos',
        duration: 3000, color: 'danger', position: 'top',
      })).present();
    } finally {
      this.isSaving = false;
    }
  }

  onPermChange(key: keyof typeof this.perms, checked: boolean): void {
    this.perms[key] = checked;
    this._extraDirty = true;
  }

  // ── Navegación ────────────────────────────────────────────────────────────────

  get hasUnsavedChanges(): boolean {
    return this.form.dirty || this._extraDirty || this.imgB64 !== this._originalImgB64;
  }

  async goBack() {
    this.ttsSvc.speakIfEnabled('volver');
    if (this.hasUnsavedChanges) {
      const dest = this.isEditMode ? ['/user-session', this.userId] : [this.returnTo];
      await this.confirmDiscard(() => this.router.navigate(dest));
      return;
    }
    if (this.isEditMode) {
      this.router.navigate(['/user-session', this.userId]);
    } else {
      this.router.navigate([this.returnTo]);
    }
  }

  private async confirmDiscard(onConfirm: () => void): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: '¿Salir sin guardar?',
      message: 'Los cambios que has hecho no se guardarán.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Salir', role: 'destructive', handler: onConfirm },
      ],
    });
    await alert.present();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }
}
