import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { UserService, FullBackendUser } from '../../services/user.service';
import { TtsService } from '../../services/tts.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';

const MAX_IMG = 2 * 1024 * 1024; // 2 MB

@Component({
  selector: 'app-user-personal-data',
  templateUrl: './user-personal-data.page.html',
  styleUrls:  ['./user-personal-data.page.scss'],
  standalone: true,
  imports: [ReactiveFormsModule, IonicModule, LoadingErrorStateComponent, AppPageHeaderComponent],
})
export class UserPersonalDataPage implements OnInit {

  userId     = '';
  targetUser: FullBackendUser | null = null;

  form!: FormGroup;

  // Imagen
  imgB64: string | null = null;
  imgUrl: SafeUrl | null = null;
  private _originalImgB64: string | null = null;

  isLoading = true;
  isSaving  = false;
  loadError = '';

  constructor(
    private route:      ActivatedRoute,
    private router:     Router,
    private fb:         FormBuilder,
    private userSvc:    UserService,
    private toastCtrl:  ToastController,
    private alertCtrl:  AlertController,
    private sanitizer:  DomSanitizer,
    private ttsSvc:     TtsService,
  ) {}

  ngOnInit() {
    this.userId = this.route.snapshot.paramMap.get('userId') ?? '';

    this.form = this.fb.group({
      name:    ['', [Validators.required, Validators.minLength(2)]],
      surname: [''],
      gender:  ['prefer_not_to_say'],
      email:   [{ value: '', disabled: true }],   // solo lectura
    });
  }

  ionViewWillEnter() {
    if (this.userId) {
      this.loadUser();
    }
  }

  // ── Carga ───────────────────────────────────────────────────────────────────

  private async loadUser(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(this.userSvc.getUserById(this.userId));
      this.targetUser = res.user;

      const name    = res.user.name    ?? '';
      const surname = res.user.surname ?? '';

      this.form.patchValue({
        name,
        surname,
        gender: res.user.gender ?? 'prefer_not_to_say',
        email:  res.user.email,
      });

      // Imagen actual
      if (res.user.image) {
        this.imgUrl = this.buildSafeUrl(res.user.image);
        this.imgB64 = res.user.image;
      }
      this._originalImgB64 = this.imgB64;
    } catch {
      this.loadError = 'Error al cargar los datos del usuario.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Imagen ──────────────────────────────────────────────────────────────────

  pickImage() {
    this.ttsSvc.speakIfEnabled('cambiar imagen');
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
      reader.onload = (ev) => {
        const b64       = ev.target!.result as string;
        this.imgB64     = b64;
        this.imgUrl     = this.sanitizer.bypassSecurityTrustUrl(b64);
      };
      reader.readAsDataURL(file);
    };

    input.click();
  }

  // ── Guardar ─────────────────────────────────────────────────────────────────

  async save() {
    this.ttsSvc.speakIfEnabled('guardar cambios');
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.isSaving = true;

    const { name, surname, gender } = this.form.getRawValue();

    try {
      await firstValueFrom(
        this.userSvc.updateUserById(this.userId, {
          name:    name.trim(),
          surname: surname?.trim() ?? '',
          gender: gender || 'prefer_not_to_say',
          image:  this.imgB64 ?? undefined,
        })
      );

      (await this.toastCtrl.create({
        message: '✓ Datos guardados correctamente',
        duration: 2200, color: 'success', position: 'top',
      })).present();

      // Volver a la sesión del usuario
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

  // ── Helpers ─────────────────────────────────────────────────────────────────

  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }

  getInitial(): string {
    return this.targetUser?.name?.charAt(0)?.toUpperCase() ?? '?';
  }

  get hasUnsavedChanges(): boolean {
    return this.form.dirty || this.imgB64 !== this._originalImgB64;
  }

  async goBack() {
    this.ttsSvc.speakIfEnabled('volver');
    if (this.hasUnsavedChanges) {
      await this.confirmDiscard(() => this.router.navigate(['/user-session', this.userId]));
      return;
    }
    this.router.navigate(['/user-session', this.userId]);
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
}
