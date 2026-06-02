import { Component, OnInit, OnDestroy } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { AuthService, AddressSuggestion } from '../../services/auth.service';
import { UserService, UpdateUserPayload, SelfPermissions, VoiceSettings, CatalogVoice } from '../../services/user.service';
import { TtsService, VoiceOption } from '../../services/tts.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';

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
  imports: [ReactiveFormsModule, IonicModule, LoadingErrorStateComponent, AppPageHeaderComponent],
})
export class UserFinalFormPage implements OnInit, OnDestroy {

  userId = '';

  /** true → PATCH sobre usuario existente; false → registro nuevo */
  get isEditMode(): boolean { return this.userId !== 'new'; }

  get pageTitle(): string { return this.isEditMode ? 'Datos personales' : 'Nuevo usuario final'; }

  form!: FormGroup;

  // ── Imagen ───────────────────────────────────────────────────────────────────
  imgB64: string | null = null;
  imgUrl: SafeUrl | null = null;

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

  /** Progreso estimado del polling (0–1), máx 95 % hasta que Python confirme */
  get voiceProcessingProgress(): number {
    return Math.min(this.voicePollingAttempts / this.MAX_POLLING_ATTEMPTS, 0.95);
  }

  /** El botón Guardar se bloquea mientras la voz personalizada está en proceso activo */
  get saveDisabledByVoice(): boolean {
    if (this.voiceMode !== 'custom') return false;
    return ['recording', 'recorded', 'creating', 'processing'].includes(this.customVoiceStep);
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

  // ── Autocompletado de dirección ──────────────────────────────────────────────
  suggestions:    AddressSuggestion[] = [];
  showSuggestions = false;
  private _lat:   number | null = null;
  private _lng:   number | null = null;
  private _city:  string | null = null;
  private _cntry: string | null = null;
  private _deb:   ReturnType<typeof setTimeout> | null = null;

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
    private ttsSvc:     TtsService,
    private toastCtrl:  ToastController,
    private sanitizer:  DomSanitizer,
  ) {}

  ngOnDestroy(): void {
    if (this.voicePollingInterval) { clearInterval(this.voicePollingInterval); this.voicePollingInterval = null; }
    this.ttsSvc.stop();
    this.mediaRec?.stop();
    this.activeStream?.getTracks().forEach(t => t.stop());
    if (this.recordedAudioUrl) URL.revokeObjectURL(this.recordedAudioUrl);
  }

  ngOnInit() {
    this.userId = this.route.snapshot.paramMap.get('userId') ?? '';

    // En creación la contraseña es obligatoria; en edición es opcional
    const pwdValidators = this.isEditMode
      ? [passwordOptional]
      : [Validators.required, Validators.minLength(6)];

    this.form = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', pwdValidators],
      name:     ['', [Validators.required, Validators.minLength(2)]],
      surname:  ['', Validators.required],
      age:      [null],
      gender:   ['prefer_not_to_say'],
      address:  [''],
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

      const parts   = u.name.trim().split(/\s+/);
      const name    = parts[0] ?? '';
      const surname = parts.slice(1).join(' ');

      this.form.patchValue({
        email:   u.email,
        name,
        surname,
        gender:  u.gender   ?? 'prefer_not_to_say',
        age:     u.age      ?? null,
        address: u.address  ?? '',
        // password vacío → no cambia
      });

      if (u.image) {
        this.imgB64 = u.image;
        this.imgUrl = this.buildSafeUrl(u.image);
      }

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
          this.customVoiceStep = cv.status === 'ready'         ? 'ready'
                               : cv.status === 'processing'    ? 'processing'
                               : cv.status === 'sample_uploaded' ? 'idle'
                               : cv.status === 'error'         ? 'error'
                               : 'idle';
          if (cv.status === 'error' && cv.lastError) {
            this.customVoiceError = cv.lastError;
          }
          if (cv.consentAccepted) this.customVoiceConsent = true;
        }
      }
      // Cargar voces siempre (el selector está siempre visible)
      void this.loadVoicesForGender(u.gender);
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
  }

  testVoice(voice: VoiceOption): void {
    const name = (this.form.get('name')?.value as string)?.trim();
    const text = name ? `Hola, me llamo ${name}, ¿qué tal estás?` : 'Hola, ¿qué tal estás?';
    this.ttsSvc.speak(text, voice);
  }

  setVoiceMode(mode: 'catalog' | 'custom'): void {
    this.voiceMode = mode;
    if (mode === 'catalog' && this.voices.length === 0 && !this.voicesLoading) {
      void this.loadVoicesForGender(this.form.get('gender')?.value);
    }
  }

  async toggleSound(): Promise<void> {
    this.soundEnabled = !this.soundEnabled;
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
      await firstValueFrom(this.userSvc.uploadVoiceSample(
        targetUserId, audioDataUrl, true,
        'Confirmo que tengo permiso para crear una voz sintética a partir de esta grabación y entiendo que se usará para generar mensajes de voz dentro de esta aplicación.',
      ));

      await firstValueFrom(this.userSvc.createVoice(targetUserId));

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
        const res    = await firstValueFrom(this.userSvc.getVoiceStatus(userId));
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
      const blob  = await firstValueFrom(
        this.userSvc.speakCustom(userId, 'Tu voz personalizada está lista. Así es como sonaré en la aplicación.')
      );
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch { /* si Python no está activo, no reproducir; la voz seguirá lista */ }
  }

  async testCustomVoice(): Promise<void> {
    const targetId = this.isEditMode ? this.userId : this.preRegisteredUserId;
    if (!targetId) return;
    this.customVoiceTesting = true;
    try {
      const blob  = await firstValueFrom(
        this.userSvc.speakCustom(targetId, 'Hola, esta es una prueba de mi voz personalizada.')
      );
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      (await this.toastCtrl.create({
        message: 'No se pudo reproducir la voz. El servicio de síntesis puede no estar activo.',
        duration: 3000, color: 'warning', position: 'top',
      })).present();
    } finally {
      this.customVoiceTesting = false;
    }
  }

  async deleteCustomVoice(): Promise<void> {
    try {
      await firstValueFrom(this.userSvc.deleteCustomVoice(this.userId));
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

  // ── Autocompletado de dirección ──────────────────────────────────────────────

  onAddressInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this._lat = this._lng = this._city = this._cntry = null;
    if (this._deb) clearTimeout(this._deb);
    if (val.length < 3) { this.suggestions = []; this.showSuggestions = false; return; }
    this._deb = setTimeout(() => {
      this.authSvc.getPlaceSuggestions(val).subscribe({
        next:  (r) => { this.suggestions = r.suggestions; this.showSuggestions = r.suggestions.length > 0; },
        error: ()  => { this.suggestions = []; this.showSuggestions = false; },
      });
    }, 300);
  }

  selectSuggestion(s: AddressSuggestion) {
    this.form.get('address')!.setValue(s.formattedAddress);
    this._lat = s.lat; this._lng = s.lng;
    this._city = s.city; this._cntry = s.country;
    this.showSuggestions = false; this.suggestions = [];
  }

  closeSuggestions() { setTimeout(() => { this.showSuggestions = false; }, 150); }

  // ── Guardar ──────────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.isSaving = true;

    const { email, password, name, surname, gender, age, address } = this.form.value;
    const fullName    = [name?.trim(), surname?.trim()].filter(Boolean).join(' ');
    const ageValue    = age != null && age !== '' ? Number(age) : null;
    const addressValue = address?.trim() || null;

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
            name:            fullName,
            email:           email?.trim(),
            gender:          gender || 'prefer_not_to_say',
            age:             ageValue,
            address:         addressValue,
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
              name:     fullName,
              type:     'user',
              gender:   gender || 'prefer_not_to_say',
              centro:   org?.centro || 'Centro ISAAC',
              image:    this.imgB64 ?? undefined,
            })
          );
          targetUserId = regRes.user.id;

          // Siempre patcheamos para guardar age, address, permisos y voz
          const patch: UpdateUserPayload = {
            age:             ageValue,
            address:         addressValue,
            selfPermissions: selfPerms,
            voiceSettings:   vs,
          };
          await firstValueFrom(this.userSvc.updateUserById(targetUserId, patch));
        }

      } else {
        // ── EDITAR ────────────────────────────────────────────────────────
        targetUserId = this.userId;
        const payload: UpdateUserPayload = {
          name:            fullName,
          email:           email?.trim(),
          gender:          gender || 'prefer_not_to_say',
          age:             ageValue,
          address:         addressValue,
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

  // ── Navegación ────────────────────────────────────────────────────────────────

  goBack() {
    if (this.isEditMode) {
      this.router.navigate(['/user-session', this.userId]);
    } else {
      this.router.navigate(['/add-user']);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }
}
