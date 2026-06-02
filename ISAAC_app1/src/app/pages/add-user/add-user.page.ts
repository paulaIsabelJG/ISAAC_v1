import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UserService, BackendUser, ChildrenAccessEntry } from '../../services/user.service';
import { PictogramStateService } from '../../services/pictogram-state.service';

type View = 'select' | 'professional' | 'family';

const MAX_IMG = 2 * 1024 * 1024;

interface FamUserRow {
  childId:                string;
  name:                   string;
  surname:                string;
  infoLabel:              string;
  image?:                 string | null;
  canViewStats:           boolean;
  canEditBoards:          boolean;
  canEditPersonalData:    boolean;
  canAddPictograms:       boolean;
  canAssignProfessionals: boolean;
  canAssignFamilies:      boolean;
  canViewAssignedBoards:  boolean;
}

@Component({
  selector: 'app-add-user',
  templateUrl: './add-user.page.html',
  styleUrls: ['./add-user.page.scss'],
  standalone: true,
  imports: [ReactiveFormsModule, IonicModule],
})
export class AddUserPage implements OnInit {

  view: View = 'select';
  isSaving   = false;

  profForm!: FormGroup;
  famForm!:  FormGroup;

  showProfPwd = false;
  showFamPwd  = false;

  profImgB64: string | null = null;  profImgUrl: SafeUrl | null = null;
  famImgB64:  string | null = null;  famImgUrl:  SafeUrl | null = null;

  famRows:          FamUserRow[] = [];
  centerFinalUsers: BackendUser[] = [];
  selectedChildId   = '';
  famUsersLoading   = false;
  famUsersError     = '';

  get headerTitle(): string {
    return ({
      select:       'Agregar usuario',
      professional: 'Nuevo profesional',
      family:       'Nuevo familiar',
    } as Record<View, string>)[this.view];
  }

  get availableFinalUsers(): BackendUser[] {
    const assignedIds = new Set(this.famRows.map(r => r.childId));
    return this.centerFinalUsers.filter(u => !assignedIds.has(u._id));
  }

  constructor(
    private fb:        FormBuilder,
    private authSvc:   AuthService,
    private userSvc:   UserService,
    private router:    Router,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private sanitizer: DomSanitizer,
    private state:     PictogramStateService,
  ) {}

  ionViewWillEnter(): void {
    this.view = 'select';
    this.profForm?.reset({ professionalType: 'Terapeuta' });
    this.famForm?.reset();
    this.profImgB64 = null; this.profImgUrl = null;
    this.famImgB64  = null; this.famImgUrl  = null;
    this.famRows    = [];
    this.selectedChildId = '';
  }

  ngOnInit() {
    this.profForm = this.fb.group({
      email:            ['', [Validators.required, Validators.email]],
      password:         ['', [Validators.required, Validators.minLength(6)]],
      name:             ['', [Validators.required, Validators.minLength(2)]],
      surname:          ['', Validators.required],
      phone:            [''],
      professionalType: ['Terapeuta'],
    });

    this.famForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  // ── Navegación ───────────────────────────────────────────────────────────────

  get hasUnsavedChanges(): boolean {
    if (this.view === 'professional') {
      return this.profForm.dirty || !!this.profImgB64;
    }
    if (this.view === 'family') {
      return this.famForm.dirty || !!this.famImgB64 || this.famRows.length > 0;
    }
    return false;
  }

  async goBack() {
    if (this.view === 'select') {
      this.router.navigate(['/organization-dashboard']);
      return;
    }
    if (this.hasUnsavedChanges) {
      await this.confirmDiscard(() => {
        this.resetCurrentForm();
        this.view = 'select';
      });
      return;
    }
    this.resetCurrentForm();
    this.view = 'select';
  }

  private resetCurrentForm(): void {
    if (this.view === 'professional') {
      this.profForm.reset({ professionalType: 'Terapeuta' });
      this.profImgB64 = null; this.profImgUrl = null;
    } else if (this.view === 'family') {
      this.famForm.reset();
      this.famImgB64 = null; this.famImgUrl = null;
      this.famRows = []; this.selectedChildId = '';
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

  setView(v: View | 'final-user'): void {
    if (v === 'final-user') {
      this.router.navigate(['/user-final-form', 'new']);
      return;
    }
    this.view = v;
    if (v === 'family' && this.centerFinalUsers.length === 0 && !this.famUsersLoading) {
      this.loadFinalUsersForFamily();
    }
  }

  goOwnPictograms() {
    this.state.userId       = null;
    this.state.returnTo     = '/add-user';
    this.state.allowedUsers = null;
    this.router.navigate(['/own-pictograms-placeholder']);
  }

  goAssignedProfessionals() {
    this.state.userId       = null;
    this.state.returnTo     = '/add-user';
    this.state.allowedUsers = null;
    this.router.navigate(['/assigned-professionals-placeholder']);
  }

  // ── Imagen ───────────────────────────────────────────────────────────────────

  pickImage(target: 'prof' | 'fam') {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';

    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (file.size > MAX_IMG) {
        (await this.toastCtrl.create({
          message: 'La imagen supera 2 MB', duration: 2500, color: 'warning', position: 'top',
        })).present();
        return;
      }

      const reader = new FileReader();
      reader.onload = ev => {
        const b64  = ev.target!.result as string;
        const safe = this.sanitizer.bypassSecurityTrustUrl(b64);
        if (target === 'prof') { this.profImgB64 = b64; this.profImgUrl = safe; }
        if (target === 'fam')  { this.famImgB64  = b64; this.famImgUrl  = safe; }
      };
      reader.readAsDataURL(file);
    };

    input.click();
  }

  // ── Guardar: Profesional ─────────────────────────────────────────────────────

  async saveProfessional() {
    if (this.profForm.invalid) { this.profForm.markAllAsTouched(); return; }
    this.isSaving = true;
    const { email, password, name, surname, professionalType } = this.profForm.value;
    const org = this.authSvc.getCurrentUser();

    this.authSvc.register({
      email, password,
      name:             [name, surname].filter(Boolean).join(' '),
      type:             'teacher',
      centro:           org?.centro || 'Centro ISAAC',
      image:            this.profImgB64 ?? undefined,
      professionalType: professionalType || 'Terapeuta',
    }).subscribe({
      next: async () => {
        this.isSaving = false;
        (await this.toastCtrl.create({
          message: '✓ Profesional añadido', duration: 2000, color: 'success', position: 'top',
        })).present();
        this.view = 'select';
        this.profForm.reset({ professionalType: 'Terapeuta' });
        this.profImgB64 = null; this.profImgUrl = null;
      },
      error: async err => {
        this.isSaving = false;
        (await this.toastCtrl.create({
          message: err?.error?.error || 'Error al añadir profesional', duration: 3000, color: 'danger', position: 'top',
        })).present();
      },
    });
  }

  // ── Guardar: Familiar ────────────────────────────────────────────────────────

  async saveFamily(): Promise<void> {
    if (this.famForm.invalid) { this.famForm.markAllAsTouched(); return; }
    this.isSaving = true;
    const { email, password } = this.famForm.value;

    try {
      const regRes = await firstValueFrom(
        this.authSvc.register({
          email, password,
          name:  email.split('@')[0],
          type:  'parent',
          image: this.famImgB64 ?? undefined,
        })
      );

      const parentId = regRes.user.id;

      if (this.famRows.length > 0 && parentId) {
        const entries: ChildrenAccessEntry[] = this.famRows.map(r => ({
          childId:                r.childId,
          canViewStats:           r.canViewStats,
          canEditBoards:          r.canEditBoards,
          canEditPersonalData:    r.canEditPersonalData,
          canAddPictograms:       r.canAddPictograms,
          canAssignProfessionals: r.canAssignProfessionals,
          canAssignFamilies:      r.canAssignFamilies,
          canViewAssignedBoards:  r.canViewAssignedBoards,
        }));
        await firstValueFrom(this.userSvc.updateChildrenAccess(parentId, entries));
      }

      this.isSaving = false;
      (await this.toastCtrl.create({
        message: '✓ Familiar añadido', duration: 2200, color: 'success', position: 'top',
      })).present();

      this.view = 'select';
      this.famForm.reset();
      this.famImgB64 = null; this.famImgUrl = null;
      this.famRows   = [];
      this.selectedChildId = '';

    } catch (err: any) {
      this.isSaving = false;
      (await this.toastCtrl.create({
        message: err?.error?.error || 'Error al añadir familiar', duration: 3000, color: 'danger', position: 'top',
      })).present();
    }
  }

  // ── Familiar: tabla de usuarios a cargo ──────────────────────────────────────

  private async loadFinalUsersForFamily(): Promise<void> {
    const org = this.authSvc.getCurrentUser();
    if (!org?.centro) { this.famUsersError = 'No se encontró el centro de la organización.'; return; }
    this.famUsersLoading = true;
    this.famUsersError   = '';
    try {
      const res = await firstValueFrom(this.userSvc.getUsersByCenter(org.centro));
      this.centerFinalUsers = res.users.filter(u => u.type === 'user');
    } catch {
      this.famUsersError = 'Error al cargar usuarios finales.';
    } finally {
      this.famUsersLoading = false;
    }
  }

  onChildSelect(event: Event): void {
    this.selectedChildId = (event as CustomEvent<{ value: string }>).detail.value ?? '';
  }

  addFamUser(): void {
    if (!this.selectedChildId) return;
    const user = this.centerFinalUsers.find(u => u._id === this.selectedChildId);
    if (!user) return;
    if (this.famRows.some(r => r.childId === user._id)) return;

    const parts = user.name.trim().split(/\s+/);
    this.famRows.push({
      childId:                user._id,
      name:                   parts[0] ?? '',
      surname:                parts.slice(1).join(' '),
      infoLabel:              this.genderLabel(user.gender),
      image:                  user.image ?? null,
      canViewStats:           false,
      canEditBoards:          false,
      canEditPersonalData:    false,
      canAddPictograms:       false,
      canAssignProfessionals: false,
      canAssignFamilies:      false,
      canViewAssignedBoards:  false,
    });
    this.selectedChildId = '';
  }

  removeFamRow(index: number): void {
    this.famRows.splice(index, 1);
  }

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
