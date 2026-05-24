import { Component } from '@angular/core';
import {
  IonicModule,
  ActionSheetController,
  AlertController,
  ToastController,
} from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import {
  PictogramStateService,
  OwnPictogram,
  WordType,
  FITZGERALD,
  FitzgeraldColor,
} from '../services/pictogram-state.service';
import { UserService, BackendPictogram } from '../services/user.service';

const MAX_IMG = 2 * 1024 * 1024; // 2 MB
const VALID_WORD_TYPES: WordType[] = [
  'verb',
  'pronoun',
  'noun',
  'descriptor',
  'social',
  'misc',
];

@Component({
  selector: 'app-own-pictograms-placeholder',
  templateUrl: './own-pictograms-placeholder.page.html',
  styleUrls: ['./own-pictograms-placeholder.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule],
})
export class OwnPictogramsPlaceholderPage {
  readonly FITZGERALD = FITZGERALD;

  // ── Estado de carga ──────────────────────────────────────────────────────────
  userId: string | null = null;
  localPictograms: OwnPictogram[] = []; // usada cuando userId está definido
  isLoading = false;
  loadError = '';

  // ── Formulario ───────────────────────────────────────────────────────────────
  formName = '';
  formWordType: WordType = 'misc';
  formDescription = '';
  formImageB64: string | null = null;
  formImageUrl: SafeUrl | null = null;
  formTouched = false;
  isSaving = false;
  imgError = '';

  // ── Modo edición ─────────────────────────────────────────────────────────────
  editingId: string | null = null;
  private _editBackup: OwnPictogram | null = null;

  // ── Getters ──────────────────────────────────────────────────────────────────

  get isEditing(): boolean {
    return !!this.editingId;
  }

  /** Lista activa: de backend si hay userId, de memoria si no */
  get pictograms(): OwnPictogram[] {
    return this.userId ? this.localPictograms : this.state.pictograms;
  }

  get selectedColor(): FitzgeraldColor {
    return (
      FITZGERALD.find((c) => c.type === this.formWordType) ?? FITZGERALD[5]
    );
  }

  getColor(type: WordType): FitzgeraldColor {
    return FITZGERALD.find((c) => c.type === type) ?? FITZGERALD[5];
  }

  constructor(
    private router: Router,
    private sanitizer: DomSanitizer,
    private state: PictogramStateService,
    private userSvc: UserService,
    private actionSheet: ActionSheetController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {}

  // ── Ciclo de vida ────────────────────────────────────────────────────────────

  ionViewWillEnter(): void {
    this.userId = this.state.userId;
    if (this.userId) {
      this.loadFromBackend();
    }
    // Sin userId → state.pictograms ya contiene los datos en memoria
  }

  goBack(): void {
    if (this.userId) {
      this.router.navigate(['/user-final-form', this.userId]);
    } else {
      this.router.navigate(['/add-user']);
    }
  }

  // ── Carga desde backend ───────────────────────────────────────────────────────
  private loadFromBackend(): void {
    if (!this.userId) return;
    this.isLoading = true;
    this.loadError = '';

    this.userSvc.getPictogramsByUserId(this.userId).subscribe({
      next: (res) => {
        this.localPictograms = res.pictograms.map((p) => this.fromBackend(p));
        this.isLoading = false;
      },
      error: () => {
        this.loadError =
          'No se pudieron cargar los pictogramas. Inténtalo de nuevo.';
        this.isLoading = false;
      },
    });
  }

  /** Convierte un BackendPictogram a OwnPictogram (sanitiza la imagen) */
  private fromBackend(p: BackendPictogram): OwnPictogram {
    return {
      id: p.id,
      name: p.label,
      wordType: this.toWordType(p.wordType),
      imageB64: p.imageUrl,
      safeImageUrl: this.sanitizer.bypassSecurityTrustUrl(p.imageUrl),
      description: p.description || undefined,
    };
  }

  private toWordType(s?: string): WordType {
    return VALID_WORD_TYPES.includes(s as WordType) ? (s as WordType) : 'misc';
  }

  // ── Selector de imagen ────────────────────────────────────────────────────────
  pickImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';

    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (file.size > MAX_IMG) {
        this.imgError = 'La imagen supera los 2 MB. Elige una más pequeña.';
        this.formImageB64 = null;
        this.formImageUrl = null;
        return;
      }

      this.imgError = '';
      const reader = new FileReader();
      reader.onload = (ev) => {
        this.formImageB64 = ev.target!.result as string;
        this.formImageUrl = this.sanitizer.bypassSecurityTrustUrl(
          this.formImageB64,
        );
      };
      reader.readAsDataURL(file);
    };

    input.click();
  }

  // ── Validación ───────────────────────────────────────────────────────────────
  get formValid(): boolean {
    return !!this.formName.trim() && !!this.formImageB64;
  }

  // ── Añadir o guardar cambios ──────────────────────────────────────────────────
  async addOrSave(): Promise<void> {
    this.formTouched = true;
    if (!this.formValid) return;

    if (this.isEditing) {
      await this.saveEdit();
    } else {
      await this.createNew();
    }
  }

  private async createNew(): Promise<void> {
    const newId = crypto.randomUUID();
    const item: OwnPictogram = {
      id: newId,
      name: this.formName.trim().toUpperCase(),
      wordType: this.formWordType,
      imageB64: this.formImageB64!,
      safeImageUrl: this.sanitizer.bypassSecurityTrustUrl(this.formImageB64!),
      description: this.formDescription.trim() || undefined,
    };

    if (this.userId) {
      this.isSaving = true;
      try {
        await firstValueFrom(
          this.userSvc.addPictogramToUser(this.userId, {
            id: newId,
            label: item.name,
            imageUrl: item.imageB64,
            wordType: item.wordType,
            description: item.description,
          }),
        );
        this.localPictograms.push(item);
        this.showToast('Pictograma añadido ✓', 'success');
      } catch {
        this.showToast('Error al guardar el pictograma', 'danger');
        this.isSaving = false;
        return;
      }
      this.isSaving = false;
    } else {
      this.state.pictograms.push(item);
      this.showToast('Pictograma añadido ✓', 'success');
    }

    this.resetForm();
  }

  private async saveEdit(): Promise<void> {
    const editId = this.editingId!;
    const updated: OwnPictogram = {
      id: editId,
      name: this.formName.trim().toUpperCase(),
      wordType: this.formWordType,
      imageB64: this.formImageB64!,
      safeImageUrl: this.sanitizer.bypassSecurityTrustUrl(this.formImageB64!),
      description: this.formDescription.trim() || undefined,
    };

    if (this.userId) {
      this.isSaving = true;
      try {
        // Eliminar versión antigua → crear nueva con el mismo id
        await firstValueFrom(
          this.userSvc.deletePictogramFromUser(this.userId, editId),
        );
        await firstValueFrom(
          this.userSvc.addPictogramToUser(this.userId, {
            id: editId,
            label: updated.name,
            imageUrl: updated.imageB64,
            wordType: updated.wordType,
            description: updated.description,
          }),
        );
        this.localPictograms.push(updated);
        this.showToast('Pictograma actualizado ✓', 'success');
      } catch {
        // Si falló, restaurar el backup a la lista
        if (this._editBackup) this.localPictograms.push(this._editBackup);
        this.showToast('Error al actualizar el pictograma', 'danger');
        this.isSaving = false;
        return;
      }
      this.isSaving = false;
    } else {
      this.state.pictograms.push(updated);
      this.showToast('Pictograma actualizado ✓', 'success');
    }

    this.editingId = null;
    this._editBackup = null;
    this.resetForm();
  }

  // ── Cancelar edición ──────────────────────────────────────────────────────────
  cancelEdit(): void {
    if (this._editBackup) {
      if (this.userId) {
        this.localPictograms.push(this._editBackup);
      } else {
        this.state.pictograms.push(this._editBackup);
      }
    }
    this.editingId = null;
    this._editBackup = null;
    this.resetForm();
  }

  // ── Menú de tres puntos ───────────────────────────────────────────────────────
  async openMenu(p: OwnPictogram): Promise<void> {
    const sheet = await this.actionSheet.create({
      header: p.name,
      cssClass: 'picto-action-sheet',
      buttons: [
        {
          text: 'Editar',
          icon: 'create-outline',
          handler: () => {
            this.startEdit(p);
          },
        },
        {
          text: 'Eliminar',
          role: 'destructive',
          icon: 'trash-outline',
          handler: () => {
            this.confirmDelete(p);
          },
        },
        {
          text: 'Cancelar',
          role: 'cancel',
          icon: 'close-circle-outline',
        },
      ],
    });
    await sheet.present();
  }

  // ── Editar ────────────────────────────────────────────────────────────────────
  startEdit(p: OwnPictogram): void {
    this._editBackup = { ...p };
    this.editingId = p.id;

    // Quitar de la lista visual
    if (this.userId) {
      this.localPictograms = this.localPictograms.filter((x) => x.id !== p.id);
    } else {
      const idx = this.state.pictograms.findIndex((x) => x.id === p.id);
      if (idx !== -1) this.state.pictograms.splice(idx, 1);
    }

    // Poblar formulario
    this.formName = p.name;
    this.formWordType = p.wordType;
    this.formDescription = p.description ?? '';
    this.formImageB64 = p.imageB64;
    this.formImageUrl = p.safeImageUrl;
    this.formTouched = false;
    this.imgError = '';
  }

  // ── Eliminar ──────────────────────────────────────────────────────────────────
  async confirmDelete(p: OwnPictogram): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar pictograma',
      message: `¿Seguro que deseas eliminar "<strong>${p.name}</strong>"? Esta acción no se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          cssClass: 'alert-btn-delete',
          handler: () => {
            this.deletePictogram(p);
          },
        },
      ],
    });
    await alert.present();
  }

  private async deletePictogram(p: OwnPictogram): Promise<void> {
    if (this.userId) {
      try {
        await firstValueFrom(
          this.userSvc.deletePictogramFromUser(this.userId, p.id),
        );
        await this.loadFromBackendAsync();
        this.showToast('Pictograma eliminado', 'success');
      } catch {
        this.showToast('Error al eliminar el pictograma', 'danger');
      }
    } else {
      const idx = this.state.pictograms.findIndex((x) => x.id === p.id);
      if (idx !== -1) this.state.pictograms.splice(idx, 1);
      this.showToast('Pictograma eliminado', 'success');
    }
  }

  //anadido
  private async loadFromBackendAsync(): Promise<void> {
    if (!this.userId) return;

    this.isLoading = true;
    this.loadError = '';

    try {
      const res = await firstValueFrom(
        this.userSvc.getPictogramsByUserId(this.userId),
      );
      this.localPictograms = res.pictograms.map((p) => this.fromBackend(p));
    } catch {
      this.loadError =
        'No se pudieron cargar los pictogramas. Inténtalo de nuevo.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Utils ─────────────────────────────────────────────────────────────────────
  private resetForm(): void {
    this.formName = '';
    this.formWordType = 'misc';
    this.formDescription = '';
    this.formImageB64 = null;
    this.formImageUrl = null;
    this.formTouched = false;
    this.imgError = '';
  }

  private async showToast(
    message: string,
    color: 'success' | 'danger' | 'warning',
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      color,
      position: 'top',
    });
    await t.present();
  }
}
