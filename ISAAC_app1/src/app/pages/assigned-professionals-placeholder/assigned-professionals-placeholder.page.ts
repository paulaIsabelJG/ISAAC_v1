import { ChangeDetectorRef, Component } from '@angular/core';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import {
  UserService,
  BackendUser,
  AssignedProfessionalEntry,
  AssignedProfessionalPayload,
} from '../../services/user.service';
import { PictogramStateService } from '../../services/pictogram-state.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';

// ─── Fila de la tabla (estado local mutable) ──────────────────────────────────
export interface ProfRow {
  professionalId:         string;
  name:                   string;
  surname:                string;
  email:                  string;
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
  selector: 'app-assigned-professionals-placeholder',
  templateUrl: './assigned-professionals-placeholder.page.html',
  styleUrls: ['./assigned-professionals-placeholder.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, LoadingErrorStateComponent, AppPageHeaderComponent],
})
export class AssignedProfessionalsPlaceholderPage {

  // ── Selector de usuario (cuando no viene preseleccionado) ────────────────────
  selectableUsers: Array<{ id: string; name: string }> = [];
  selectableUsersLoading = false;
  selectedUserId = '';

  // ── Contexto ──────────────────────────────────────────────────────────────────
  userId: string | null = null;

  // ── Datos del centro ──────────────────────────────────────────────────────────
  /** Todos los teachers del centro (excluye al org actual) */
  centerProfessionals: BackendUser[] = [];

  // ── Tabla ─────────────────────────────────────────────────────────────────────
  rows: ProfRow[] = [];

  // ── Control de "añadir" ───────────────────────────────────────────────────────
  selectedProfId = '';

  private _savedSnapshot = '[]';

  // ── Estados ───────────────────────────────────────────────────────────────────
  isLoading = false;
  isSaving  = false;
  loadError = '';

  // ── Getters ───────────────────────────────────────────────────────────────────

  get hasUserId(): boolean {
    return !!this.userId;
  }

  /** Professionals del centro que aún no están en la tabla (sin duplicados) */
  get availableProfessionals(): BackendUser[] {
    const assignedIds = new Set(this.rows.map((r) => r.professionalId));
    return this.centerProfessionals.filter((p) => !assignedIds.has(p._id));
  }

  constructor(
    private router:      Router,
    private sanitizer:   DomSanitizer,
    private authService: AuthService,
    private userService: UserService,
    private state:       PictogramStateService,
    private toastCtrl:   ToastController,
    private alertCtrl:   AlertController,
    private cdr:         ChangeDetectorRef,
  ) {}

  // ── Ciclo de vida ─────────────────────────────────────────────────────────────

  ionViewWillEnter(): void {
    this.userId         = this.state.userId;
    this.selectedUserId = this.userId ?? '';
    this.rows           = [];
    this._savedSnapshot = '[]';
    this.loadSelectableUsers();
    if (this.userId) {
      this.loadData();
    }
  }

  private rowsSnapshot(): string {
    return JSON.stringify(this.rows.map(r => [
      r.professionalId,
      r.canViewStats, r.canEditBoards, r.canEditPersonalData,
      r.canAddPictograms, r.canAssignProfessionals, r.canAssignFamilies,
      r.canViewAssignedBoards,
    ]));
  }

  get hasUnsavedChanges(): boolean {
    return this.rowsSnapshot() !== this._savedSnapshot;
  }

  async goBack(): Promise<void> {
    if (this.hasUnsavedChanges) {
      const alert = await this.alertCtrl.create({
        header: '¿Salir sin guardar?',
        message: 'Los cambios que has hecho no se guardarán.',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Salir', role: 'destructive', handler: () => this.router.navigateByUrl(this.state.returnTo) },
        ],
      });
      await alert.present();
      return;
    }
    this.router.navigateByUrl(this.state.returnTo);
  }

  // ── Selector de usuario ───────────────────────────────────────────────────────

  private async loadSelectableUsers(): Promise<void> {
    if (this.state.allowedUsers !== null) {
      this.selectableUsers = this.state.allowedUsers;
      return;
    }

    const me = this.authService.getCurrentUser();
    if (!me) return;

    this.selectableUsersLoading = true;
    try {
      const res = await firstValueFrom(this.userService.getUsersByCenter(me.centro ?? ''));
      this.selectableUsers = res.users
        .filter((u) => u.type === 'user')
        .map((u) => ({ id: u._id, name: [u.name, u.surname].filter(Boolean).join(' ') }));
    } catch {
      // Lista vacía
    } finally {
      this.selectableUsersLoading = false;
      this.cdr.detectChanges();
    }
  }

  async onUserSelect(event: Event): Promise<void> {
    const newId = (event as CustomEvent<{ value: string }>).detail.value;
    if (!newId || newId === this.userId) return;

    if (this.hasUnsavedChanges) {
      const prevId = this.userId ?? '';
      const alert = await this.alertCtrl.create({
        header: '¿Cambiar de usuario?',
        message: 'Tienes cambios sin guardar que se perderán.',
        buttons: [
          { text: 'Cancelar', role: 'cancel', handler: () => {
            setTimeout(() => { this.selectedUserId = prevId; }, 0);
          }},
          { text: 'Cambiar', role: 'destructive', handler: () => {
            this.switchToUser(newId);
          }},
        ],
      });
      await alert.present();
      return;
    }

    this.switchToUser(newId);
  }

  private switchToUser(id: string): void {
    this.userId         = id;
    this.selectedUserId = id;
    this.state.userId   = id;
    this.rows           = [];
    this._savedSnapshot = '[]';
    this.loadData();
  }


  // ── Carga inicial ─────────────────────────────────────────────────────────────

  private async loadData(): Promise<void> {
    const org = this.authService.getCurrentUser();
    if (!org?.centro) {
      this.loadError = 'No se encontró el centro asociado a esta cuenta.';
      return;
    }

    this.isLoading = true;
    this.loadError = '';

    try {
      // 1. Cargar todos los profesionales del centro
      const centerRes = await firstValueFrom(
        this.userService.getUsersByCenter(org.centro)
      );
      this.centerProfessionals = centerRes.users.filter(
        (u) => u.type === 'teacher' && u.email !== org.email
      );

      // 2. Si hay userId, cargar los ya asignados
      if (this.userId) {
        const apRes = await firstValueFrom(
          this.userService.getAssignedProfessionals(this.userId)
        );
        this.rows = apRes.assignedProfessionals.map((ap) =>
          this.entryToRow(ap)
        );
      }
      this._savedSnapshot = this.rowsSnapshot();
    } catch {
      this.loadError = 'Error al cargar datos. Inténtalo de nuevo.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Añadir profesional a la tabla ─────────────────────────────────────────────

  addProfessional(): void {
    if (!this.selectedProfId) return;

    const prof = this.centerProfessionals.find(
      (p) => p._id === this.selectedProfId
    );
    if (!prof) return;

    // Doble check de duplicado
    if (this.rows.some((r) => r.professionalId === prof._id)) return;

    const parts = prof.name.trim().split(/\s+/);
    this.rows.push({
      professionalId:         prof._id,
      name:                   parts[0] ?? '',
      surname:                parts.slice(1).join(' '),
      email:                  prof.email,
      image:                  prof.image ?? null,
      canViewStats:           false,
      canEditBoards:          false,
      canEditPersonalData:    false,
      canAddPictograms:       false,
      canAssignProfessionals: false,
      canAssignFamilies:      false,
      canViewAssignedBoards:  false,
    });

    this.selectedProfId = '';
  }

  // ── Eliminar fila ─────────────────────────────────────────────────────────────

  removeRow(index: number): void {
    this.rows.splice(index, 1);
  }

  // ── Guardar ───────────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    if (!this.userId) {
      this.showToast(
        'El usuario aún no está registrado. Guárdalo primero desde el formulario.',
        'warning'
      );
      return;
    }

    this.isSaving = true;

    const payload: AssignedProfessionalPayload[] = this.rows.map((r) => ({
      professionalId:         r.professionalId,
      canViewStats:           r.canViewStats,
      canEditBoards:          r.canEditBoards,
      canEditPersonalData:    r.canEditPersonalData,
      canAddPictograms:       r.canAddPictograms,
      canAssignProfessionals: r.canAssignProfessionals,
      canAssignFamilies:      r.canAssignFamilies,
      canViewAssignedBoards:  r.canViewAssignedBoards,
    }));

    try {
      await firstValueFrom(
        this.userService.updateAssignedProfessionals(this.userId, payload)
      );
      this._savedSnapshot = this.rowsSnapshot();
      this.showToast('Profesionales encargados guardados ✓', 'success');
    } catch {
      this.showToast('Error al guardar. Inténtalo de nuevo.', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }

  getInitial(row: ProfRow): string {
    return row.name.charAt(0).toUpperCase() || '?';
  }

  private entryToRow(ap: AssignedProfessionalEntry): ProfRow {
    return {
      professionalId:         ap.professionalId,
      name:                   ap.name,
      surname:                ap.surname,
      email:                  ap.email,
      image:                  ap.image ?? null,
      canViewStats:           ap.canViewStats,
      canEditBoards:          ap.canEditBoards,
      canEditPersonalData:    ap.canEditPersonalData,
      canAddPictograms:       ap.canAddPictograms,
      canAssignProfessionals: ap.canAssignProfessionals,
      canAssignFamilies:      ap.canAssignFamilies,
      canViewAssignedBoards:  ap.canViewAssignedBoards,
    };
  }

  private async showToast(
    message: string,
    color:   'success' | 'danger' | 'warning'
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      color,
      position: 'top',
    });
    await t.present();
  }
}
