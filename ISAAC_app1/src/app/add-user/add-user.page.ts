import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { AuthService, AddressSuggestion } from '../services/auth.service';
import { UserService, BackendUser, ChildrenAccessEntry, SelfPermissions } from '../services/user.service';
import { PictogramStateService } from '../services/pictogram-state.service';

type View = 'select' | 'professional' | 'final-user' | 'family';

const MAX_IMG = 2 * 1024 * 1024; // 2 MB

// ─── Fila de la tabla de usuarios a cargo del familiar ────────────────────────
interface FamUserRow {
  childId:            string;
  name:               string;
  surname:            string;
  infoLabel:          string;   // género traducido o "Sin información"
  image?:             string | null;
  canViewStats:       boolean;
  canEditBoards:      boolean;
  canEditPersonalData: boolean;
}

@Component({
  selector: 'app-add-user',
  templateUrl: './add-user.page.html',
  styleUrls: ['./add-user.page.scss'],
  standalone: true,
  imports: [ReactiveFormsModule, IonicModule],
})
export class AddUserPage implements OnInit {

  // ── Vista activa ────────────────────────────────────────────────────
  view: View = 'select';
  isSaving   = false;

  // ── Formularios ─────────────────────────────────────────────────────
  profForm!:  FormGroup;
  finalForm!: FormGroup;
  famForm!:   FormGroup;

  // ── Toggle contraseñas ──────────────────────────────────────────────
  showProfPwd  = false;
  showFinalPwd = false;
  showFamPwd   = false;

  // ── Imágenes ────────────────────────────────────────────────────────
  profImgB64:  string | null = null;  profImgUrl:  SafeUrl | null = null;
  finalImgB64: string | null = null;  finalImgUrl: SafeUrl | null = null;
  famImgB64:   string | null = null;  famImgUrl:   SafeUrl | null = null;

  // ── Usuario final: extras ────────────────────────────────────────────
  soundEnabled = true;
  perms = { editData: false, editBoards: false, editStats: false };

  // ── Autocompletado de dirección ──────────────────────────────────────
  suggestions:     AddressSuggestion[] = [];
  showSuggestions  = false;
  private _lat:     number | null = null;
  private _lng:     number | null = null;
  private _city:    string | null = null;
  private _country: string | null = null;
  private _deb: ReturnType<typeof setTimeout> | null = null;

  // ── Familiar: tabla de usuarios a cargo ─────────────────────────────
  famRows:          FamUserRow[] = [];
  centerFinalUsers: BackendUser[] = [];
  selectedChildId   = '';
  famUsersLoading   = false;
  famUsersError     = '';

  // ── Getters ──────────────────────────────────────────────────────────

  get headerTitle(): string {
    return ({
      select:       'Agregar usuario',
      professional: 'Nuevo profesional',
      'final-user': 'Nuevo usuario final',
      family:       'Nuevo familiar',
    } as Record<View, string>)[this.view];
  }

  /** Usuarios finales del centro que aún no están en la tabla */
  get availableFinalUsers(): BackendUser[] {
    const assignedIds = new Set(this.famRows.map((r) => r.childId));
    return this.centerFinalUsers.filter((u) => !assignedIds.has(u._id));
  }

  constructor(
    private fb:        FormBuilder,
    private authSvc:   AuthService,
    private userSvc:   UserService,
    private router:    Router,
    private toastCtrl: ToastController,
    private sanitizer: DomSanitizer,
    private state:     PictogramStateService,
  ) {}

  ngOnInit() {
    this.profForm = this.fb.group({
      email:            ['', [Validators.required, Validators.email]],
      password:         ['', [Validators.required, Validators.minLength(6)]],
      name:             ['', [Validators.required, Validators.minLength(2)]],
      surname:          ['', Validators.required],
      phone:            [''],
      professionalType: ['Terapeuta'],
    });

    this.finalForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      name:     ['', [Validators.required, Validators.minLength(2)]],
      surname:  ['', Validators.required],
      age:      [null],
      gender:   ['prefer_not_to_say'],
      address:  [''],
    });

    this.famForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  // ── Navegación ───────────────────────────────────────────────────────

  goBack() {
    this.view === 'select'
      ? this.router.navigate(['/organization-dashboard'])
      : (this.view = 'select');
  }

  setView(v: View): void {
    this.view = v;
    // Cargar usuarios finales del centro la primera vez que se abre el formulario
    if (v === 'family' && this.centerFinalUsers.length === 0 && !this.famUsersLoading) {
      this.loadFinalUsersForFamily();
    }
  }

  goOwnPictograms() {
    this.state.userId = null;   // modo creación: sin userId → goBack() volverá a /add-user
    this.router.navigate(['/own-pictograms-placeholder']);
  }
  goAssignedProfessionals() {
    this.state.userId = null;   // modo creación: sin userId → goBack() volverá a /add-user
    this.router.navigate(['/assigned-professionals-placeholder']);
  }

  // ── Selector de imagen ───────────────────────────────────────────────

  pickImage(target: 'prof' | 'final' | 'fam') {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';

    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (file.size > MAX_IMG) {
        const t = await this.toastCtrl.create({
          message: 'La imagen supera 2 MB', duration: 2500, color: 'warning', position: 'top',
        });
        await t.present();
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const b64  = ev.target!.result as string;
        const safe = this.sanitizer.bypassSecurityTrustUrl(b64);
        if (target === 'prof')  { this.profImgB64  = b64; this.profImgUrl  = safe; }
        if (target === 'final') { this.finalImgB64 = b64; this.finalImgUrl = safe; }
        if (target === 'fam')   { this.famImgB64   = b64; this.famImgUrl   = safe; }
      };
      reader.readAsDataURL(file);
    };

    input.click();
  }

  // ── Sonido ───────────────────────────────────────────────────────────

  toggleSound() { this.soundEnabled = !this.soundEnabled; }

  // ── Autocompletado de dirección ──────────────────────────────────────

  onAddressInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this._lat = this._lng = this._city = this._country = null;
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
    this.finalForm.get('address')!.setValue(s.formattedAddress);
    this._lat = s.lat; this._lng = s.lng; this._city = s.city; this._country = s.country;
    this.showSuggestions = false; this.suggestions = [];
  }

  closeSuggestions() { setTimeout(() => { this.showSuggestions = false; }, 150); }

  // ── Guardar: Profesional ─────────────────────────────────────────────

  async saveProfessional() {
    if (this.profForm.invalid) { this.profForm.markAllAsTouched(); return; }
    this.isSaving = true;
    const { email, password, name, surname } = this.profForm.value;
    const org = this.authSvc.getCurrentUser();

    this.authSvc.register({
      email, password,
      name:   [name, surname].filter(Boolean).join(' '),
      type:   'teacher',
      centro: org?.centro || 'Centro ISAAC',
      image:  this.profImgB64 ?? undefined,
    }).subscribe({
      next: async () => {
        this.isSaving = false;
        (await this.toastCtrl.create({ message: '✓ Profesional añadido', duration: 2000, color: 'success', position: 'top' })).present();
        this.view = 'select';
        this.profForm.reset({ professionalType: 'Terapeuta' });
        this.profImgB64 = null; this.profImgUrl = null;
      },
      error: async (err) => {
        this.isSaving = false;
        (await this.toastCtrl.create({ message: err?.error?.error || 'Error al añadir profesional', duration: 3000, color: 'danger', position: 'top' })).present();
      },
    });
  }

  // ── Guardar: Usuario final ───────────────────────────────────────────

  async saveFinalUser() {
    if (this.finalForm.invalid) { this.finalForm.markAllAsTouched(); return; }
    this.isSaving = true;
    const { email, password, name, surname, gender } = this.finalForm.value;
    const org = this.authSvc.getCurrentUser();

    try {
      // 1. Crear el usuario final
      const regRes = await firstValueFrom(
        this.authSvc.register({
          email, password,
          name:   [name, surname].filter(Boolean).join(' '),
          type:   'user',
          gender,
          centro: org?.centro || 'Centro ISAAC',
          image:  this.finalImgB64 ?? undefined,
        })
      );

      // 2. Si hay algún permiso activo, guardarlo en selfPermissions del usuario creado
      if (this.perms.editData || this.perms.editBoards || this.perms.editStats) {
        const selfPerms: SelfPermissions = {
          canEditPersonalData: this.perms.editData,
          canEditBoards:       this.perms.editBoards,
          canViewStats:        this.perms.editStats,
        };
        await firstValueFrom(
          this.userSvc.updateUserById(regRes.user.id, { selfPermissions: selfPerms })
        );
      }

      this.isSaving = false;
      (await this.toastCtrl.create({
        message: '✓ Usuario añadido', duration: 2000, color: 'success', position: 'top',
      })).present();

      // Reset completo del formulario
      this.view = 'select';
      this.finalForm.reset({ gender: 'prefer_not_to_say' });
      this.finalImgB64 = null; this.finalImgUrl = null;
      this._lat = this._lng = null;
      this.perms = { editData: false, editBoards: false, editStats: false };
      this.centerFinalUsers = []; // Invalidar caché para el familiar

    } catch (err: any) {
      this.isSaving = false;
      (await this.toastCtrl.create({
        message: err?.error?.error || 'Error al añadir usuario', duration: 3000, color: 'danger', position: 'top',
      })).present();
    }
  }

  // ── Guardar: Familiar ────────────────────────────────────────────────

  async saveFamily(): Promise<void> {
    if (this.famForm.invalid) { this.famForm.markAllAsTouched(); return; }
    this.isSaving = true;
    const { email, password } = this.famForm.value;

    try {
      // Paso 1: Registrar el familiar (type='parent')
      const regRes = await firstValueFrom(
        this.authSvc.register({
          email, password,
          name:  email.split('@')[0],
          type:  'parent',
          image: this.famImgB64 ?? undefined,
        })
      );

      const parentId = regRes.user.id;

      // Paso 2: Guardar childrenAccess si hay filas en la tabla
      if (this.famRows.length > 0 && parentId) {
        const entries: ChildrenAccessEntry[] = this.famRows.map((r) => ({
          childId:            r.childId,
          canViewStats:       r.canViewStats,
          canEditBoards:      r.canEditBoards,
          canEditPersonalData: r.canEditPersonalData,
        }));
        await firstValueFrom(
          this.userSvc.updateChildrenAccess(parentId, entries)
        );
      }

      this.isSaving = false;
      const t = await this.toastCtrl.create({
        message: '✓ Familiar añadido', duration: 2200, color: 'success', position: 'top',
      });
      await t.present();

      // Reset completo
      this.view = 'select';
      this.famForm.reset();
      this.famImgB64 = null;
      this.famImgUrl = null;
      this.famRows   = [];
      this.selectedChildId = '';

    } catch (err: any) {
      this.isSaving = false;
      const t = await this.toastCtrl.create({
        message:  err?.error?.error || 'Error al añadir familiar',
        duration: 3000, color: 'danger', position: 'top',
      });
      await t.present();
    }
  }

  // ── Familiar: tabla de usuarios a cargo ──────────────────────────────

  private async loadFinalUsersForFamily(): Promise<void> {
    const org = this.authSvc.getCurrentUser();
    if (!org?.centro) {
      this.famUsersError = 'No se encontró el centro de la organización.';
      return;
    }
    this.famUsersLoading = true;
    this.famUsersError   = '';
    try {
      const res = await firstValueFrom(
        this.userSvc.getUsersByCenter(org.centro)
      );
      this.centerFinalUsers = res.users.filter((u) => u.type === 'user');
    } catch {
      this.famUsersError = 'Error al cargar usuarios finales.';
    } finally {
      this.famUsersLoading = false;
    }
  }

  /** Recibe el cambio del ion-select para la fila de añadir */
  onChildSelect(event: Event): void {
    this.selectedChildId = (event as CustomEvent<{ value: string }>).detail.value ?? '';
  }

  addFamUser(): void {
    if (!this.selectedChildId) return;
    const user = this.centerFinalUsers.find((u) => u._id === this.selectedChildId);
    if (!user) return;
    if (this.famRows.some((r) => r.childId === user._id)) return; // sin duplicados

    const parts = user.name.trim().split(/\s+/);
    this.famRows.push({
      childId:            user._id,
      name:               parts[0] ?? '',
      surname:            parts.slice(1).join(' '),
      infoLabel:          this.genderLabel(user.gender),
      image:              user.image ?? null,
      canViewStats:       false,
      canEditBoards:      false,
      canEditPersonalData: false,
    });
    this.selectedChildId = '';
  }

  removeFamRow(index: number): void {
    this.famRows.splice(index, 1);
  }

  /** Sanitiza imágenes base64 o URLs directas (usada en tabla de familiar) */
  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }

  private genderLabel(gender?: string | null): string {
    const labels: Record<string, string> = {
      male:              'Masculino',
      female:            'Femenino',
      other:             'Otro género',
      prefer_not_to_say: 'No especificado',
    };
    return gender ? (labels[gender] ?? gender) : 'Sin información';
  }
}
