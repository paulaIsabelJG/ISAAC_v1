import { Component, OnInit } from '@angular/core';
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
import { buildSafeUrl as buildSafeUrlUtil } from '../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { AuthService, AddressSuggestion } from '../services/auth.service';
import { UserService, UpdateUserPayload, SelfPermissions } from '../services/user.service';
import { PictogramStateService } from '../services/pictogram-state.service';
import { LoadingErrorStateComponent } from '../shared/components/loading-error-state/loading-error-state.component';
import { AppPageHeaderComponent } from '../shared/components/app-page-header/app-page-header.component';

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
export class UserFinalFormPage implements OnInit {

  userId = '';

  form!: FormGroup;

  // ── Imagen ───────────────────────────────────────────────────────────────────
  imgB64: string | null = null;
  imgUrl: SafeUrl | null = null;

  // ── Toggle contraseña ────────────────────────────────────────────────────────
  showPwd = false;

  // ── Sonido ───────────────────────────────────────────────────────────────────
  soundEnabled = true;

  // ── Permisos (visuales, sin backend por ahora) ───────────────────────────────
  perms = { editData: false, editBoards: false, editStats: false };

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
    private state:      PictogramStateService,
    private toastCtrl:  ToastController,
    private sanitizer:  DomSanitizer,
  ) {}

  ngOnInit() {
    this.userId = this.route.snapshot.paramMap.get('userId') ?? '';

    this.form = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [passwordOptional]],
      name:     ['', [Validators.required, Validators.minLength(2)]],
      surname:  ['', Validators.required],
      age:      [null],                   // visual — no persistido en backend
      gender:   ['prefer_not_to_say'],
      address:  [''],                     // visual — geocodificación
    });

    // Establecer userId en el servicio de estado desde el inicio
    this.state.userId = this.userId || null;
  }

  ionViewWillEnter() {
    // Refrescar por si se volvió de pictogramas/profesionales
    this.state.userId = this.userId || null;

    if (this.userId && this.isLoading) {
      this.loadUser();
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
        gender: u.gender ?? 'prefer_not_to_say',
        // password vacío → no cambia
        // age y address vacíos (no persisten en backend)
      });

      if (u.image) {
        this.imgB64 = u.image;
        this.imgUrl = this.buildSafeUrl(u.image);
      }

      // Precargar selfPermissions en los checkboxes
      const sp = u.selfPermissions;
      this.perms = {
        editData:   sp?.canEditPersonalData ?? false,
        editBoards: sp?.canEditBoards       ?? false,
        editStats:  sp?.canViewStats        ?? false,
      };
    } catch {
      this.loadError = 'Error al cargar los datos del usuario.';
    } finally {
      this.isLoading = false;
    }
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

  // ── Sonido ───────────────────────────────────────────────────────────────────

  toggleSound() { this.soundEnabled = !this.soundEnabled; }

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

    const { email, password, name, surname, gender } = this.form.value;
    const fullName = [name?.trim(), surname?.trim()].filter(Boolean).join(' ');

    const selfPerms: SelfPermissions = {
      canEditPersonalData: this.perms.editData,
      canEditBoards:       this.perms.editBoards,
      canViewStats:        this.perms.editStats,
    };

    const payload: UpdateUserPayload = {
      name:             fullName,
      email:            email?.trim(),
      gender:           gender || 'prefer_not_to_say',
      image:            this.imgB64 ?? undefined,
      selfPermissions:  selfPerms,
    };

    // Solo incluir contraseña si el usuario escribió algo
    if (password && password.trim().length >= 6) {
      payload.password = password.trim();
    }

    try {
      await firstValueFrom(this.userSvc.updateUserById(this.userId, payload));

      (await this.toastCtrl.create({
        message: '✓ Datos actualizados correctamente',
        duration: 2200, color: 'success', position: 'top',
      })).present();

      this.router.navigate(['/user-session', this.userId]);

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

  /** Siempre vuelve al perfil/sesión del usuario final */
  goBack() {
    this.router.navigate(['/user-session', this.userId]);
  }

  /**
   * Antes de ir a pictogramas, asegurar que el servicio tiene el userId correcto.
   * Own-pictograms lo leerá en ionViewWillEnter y cargará desde backend.
   */
  goOwnPictograms() {
    this.state.userId = this.userId;
    this.router.navigate(['/own-pictograms-placeholder']);
  }

  /**
   * Antes de ir a profesionales encargados, establecer el userId.
   * Assigned-professionals lo leerá en ionViewWillEnter.
   */
  goAssignedProfessionals() {
    this.state.userId = this.userId;
    this.router.navigate(['/assigned-professionals-placeholder']);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }
}
