import { Component, OnInit } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UserService, BackendUser } from '../../services/user.service';
import { ObjectiveService, ObjectiveUser } from '../../services/objective.service';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { UserMultiselectComponent } from '../../components/user-multiselect/user-multiselect.component';

@Component({
  selector: 'app-objective-form',
  templateUrl: './objective-form.page.html',
  styleUrls:  ['./objective-form.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, AppPageHeaderComponent, LoadingErrorStateComponent, UserMultiselectComponent],
})
export class ObjectiveFormPage implements OnInit {

  // Modo edición
  objectiveId = '';
  get isEditing(): boolean { return !!this.objectiveId; }

  returnTo = '/objectives-list';

  // Estado de carga
  isLoading  = true;
  loadError  = '';
  isSaving   = false;
  saveError  = '';

  // Campos del formulario
  title            = '';
  description      = '';
  startDate        = '';
  endDate          = '';
  showToFinalUser  = false;
  showToFamily     = false;

  // Selecciones múltiples (IDs)
  selectedUserIds:   string[] = [];
  selectedFamilyIds: string[] = [];

  // Datos para los selectores
  availableUsers:   BackendUser[] = [];
  availableFamilies: ObjectiveUser[] = [];

  // Control UI
  familiesLoading = false;

  constructor(
    private route:    ActivatedRoute,
    private router:   Router,
    private authSvc:  AuthService,
    private userSvc:  UserService,
    private objSvc:   ObjectiveService,
    private toast:    ToastController,
  ) {}

  ngOnInit() {
    this.objectiveId = this.route.snapshot.paramMap.get('id') ?? '';
    this.returnTo    = this.route.snapshot.queryParamMap.get('returnTo') ?? '/objectives-list';
  }

  async ionViewWillEnter() {
    this.isLoading = true;
    this.loadError = '';
    try {
      await this.loadAvailableUsers();
      if (this.isEditing) await this.loadObjective();
    } catch (err: any) {
      this.loadError = err?.error?.error ?? 'Error al cargar los datos.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Carga inicial ─────────────────────────────────────────────────────────

  private async loadAvailableUsers(): Promise<void> {
    const user = this.authSvc.getCurrentUser();
    if (!user) return;

    if (user.professionalType) {
      // Profesional: solo sus usuarios asignados
      const res = await firstValueFrom(this.userSvc.getAssignedUsers(user.id));
      this.availableUsers = res.users.map(u => ({
        _id: u.userId, name: u.name, surname: u.surname, email: u.email,
        type: 'user' as any, image: u.image,
      }));
    } else {
      // Organización: todos los usuarios finales del centro
      const centro = user.centro;
      if (!centro) return;
      const res = await firstValueFrom(this.userSvc.getUsersByCenter(centro));
      this.availableUsers = res.users.filter(u => u.type === 'user');
    }
  }

  private async loadObjective(): Promise<void> {
    const res = await firstValueFrom(this.objSvc.getObjectiveById(this.objectiveId));
    const obj = res.objective;

    this.title           = obj.title;
    this.description     = obj.description;
    this.startDate       = this.toDatetimeLocal(obj.startDate);
    this.endDate         = this.toDatetimeLocal(obj.endDate);
    this.showToFinalUser = obj.showToFinalUser;
    this.showToFamily    = obj.showToFamily;
    this.selectedUserIds  = obj.assignedUserIds.map(u => u._id);
    this.selectedFamilyIds = obj.familyRecipientIds.map(u => u._id);

    if (this.selectedUserIds.length > 0) {
      await this.loadFamilies();
    }
  }

  // ── Familias según usuarios seleccionados ─────────────────────────────────

  async loadFamilies(): Promise<void> {
    if (!this.selectedUserIds.length) {
      this.availableFamilies = [];
      return;
    }
    this.familiesLoading = true;
    try {
      const res = await firstValueFrom(this.objSvc.getFamiliesForUsers(this.selectedUserIds));
      this.availableFamilies = res.families;
      // Eliminar selecciones de familias que ya no están disponibles
      this.selectedFamilyIds = this.selectedFamilyIds.filter(
        id => this.availableFamilies.some(f => f._id === id)
      );
    } finally {
      this.familiesLoading = false;
    }
  }

  // ── Toggle selecciones ────────────────────────────────────────────────────

  toggleUser(userId: string): void {
    const idx = this.selectedUserIds.indexOf(userId);
    if (idx >= 0) {
      this.selectedUserIds.splice(idx, 1);
    } else {
      this.selectedUserIds.push(userId);
    }
    void this.loadFamilies();
  }

  isUserSelected(userId: string): boolean {
    return this.selectedUserIds.includes(userId);
  }

  toggleFamily(familyId: string): void {
    const idx = this.selectedFamilyIds.indexOf(familyId);
    if (idx >= 0) {
      this.selectedFamilyIds.splice(idx, 1);
    } else {
      this.selectedFamilyIds.push(familyId);
    }
  }

  isFamilySelected(familyId: string): boolean {
    return this.selectedFamilyIds.includes(familyId);
  }

  onUserSelectionChange(ids: string[]): void {
    this.selectedUserIds = ids;
    void this.loadFamilies();
  }

  onFamilySelectionChange(ids: string[]): void {
    this.selectedFamilyIds = ids;
  }

  onShowToFamilyChange(): void {
    if (!this.showToFamily) {
      this.selectedFamilyIds = [];
    }
  }

  // ── Guardar ───────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    this.saveError = '';

    // Validaciones
    if (!this.title.trim()) {
      this.saveError = 'El título es obligatorio.';
      return;
    }
    if (!this.selectedUserIds.length) {
      this.saveError = 'Selecciona al menos un usuario final.';
      return;
    }
    if (!this.startDate || !this.endDate) {
      this.saveError = 'Las fechas de inicio y fin son obligatorias.';
      return;
    }
    if (new Date(this.endDate) <= new Date(this.startDate)) {
      this.saveError = 'La fecha de fin debe ser posterior a la de inicio.';
      return;
    }
    if (this.showToFamily && !this.selectedFamilyIds.length) {
      this.saveError = 'Si activas el aviso a familiares, selecciona al menos uno.';
      return;
    }

    this.isSaving = true;
    try {
      const payload = {
        title:              this.title.trim(),
        description:        this.description.trim(),
        assignedUserIds:    this.selectedUserIds,
        familyRecipientIds: this.showToFamily ? this.selectedFamilyIds : [],
        startDate:          new Date(this.startDate).toISOString(),
        endDate:            new Date(this.endDate).toISOString(),
        showToFinalUser:    this.showToFinalUser,
        showToFamily:       this.showToFamily,
      };

      if (this.isEditing) {
        await firstValueFrom(this.objSvc.updateObjective(this.objectiveId, payload));
      } else {
        await firstValueFrom(this.objSvc.createObjective(payload));
      }

      await this.showToast(
        this.isEditing ? 'Objetivo actualizado correctamente.' : 'Objetivo creado correctamente.',
        'success',
      );
      this.router.navigateByUrl(this.returnTo);

    } catch (err: any) {
      this.saveError = err?.error?.error ?? 'Error al guardar el objetivo.';
    } finally {
      this.isSaving = false;
    }
  }

  goBack(): void {
    this.router.navigateByUrl(this.returnTo);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Convierte ISO a formato compatible con <input type="datetime-local"> */
  private toDatetimeLocal(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  userName(u: BackendUser): string {
    return [u.name, (u as any).surname].filter(Boolean).join(' ');
  }

  familyName(f: ObjectiveUser): string {
    return [f.name, f.surname].filter(Boolean).join(' ');
  }

  private async showToast(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, duration: 2500, color, position: 'top' });
    await t.present();
  }
}
