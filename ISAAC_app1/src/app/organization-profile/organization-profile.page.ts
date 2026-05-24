import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { AuthService, User } from '../services/auth.service';

/** Tamaño máximo permitido para imagen base64 (2 MB) */
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

@Component({
  selector: 'app-organization-profile',
  templateUrl: './organization-profile.page.html',
  styleUrls: ['./organization-profile.page.scss'],
  standalone: true,
  imports: [ReactiveFormsModule, IonicModule],
})
export class OrganizationProfilePage implements OnInit {
  profileForm!: FormGroup;
  isSaving = false;
  user: User | null = null;

  /** Controla si el campo contraseña muestra texto plano o puntos */
  showPassword = false;

  /**
   * URL para mostrar el preview de la imagen.
   * Puede ser una URL normal o un data: URI (base64).
   * Usamos SafeUrl para evitar que el sanitizador de Angular lo bloquee.
   */
  previewUrl: SafeUrl | null = null;

  /**
   * String base64 cruda que se enviará al backend.
   * El campo `image` del modelo User acepta cualquier String.
   */
  private imageBase64: string | null = null;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.user = this.authService.getCurrentUser();

    this.profileForm = this.fb.group({
      name:     [this.user?.name   || '', [Validators.required, Validators.minLength(2)]],
      email:    [this.user?.email  || '', [Validators.required, Validators.email]],
      password: [''],           // Vacío por defecto — solo se envía si el usuario escribe algo
      centro:   [this.user?.centro || ''],
    });

    // Inicializar preview con la imagen almacenada (si existe)
    if (this.user?.image) {
      this.previewUrl = this.sanitizer.bypassSecurityTrustUrl(this.user.image);
      this.imageBase64 = this.user.image;
    }
  }

  // ─── Selector de imagen ───────────────────────────────────────────────────

  /** Abre el explorador de archivos al hacer clic en el avatar */
  onAvatarClick(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';

    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        const toast = await this.toastCtrl.create({
          message: 'La imagen no puede superar 2 MB',
          duration: 2500,
          color: 'warning',
          position: 'top',
        });
        await toast.present();
        return;
      }

      const reader = new FileReader();
      reader.onload = (event: ProgressEvent<FileReader>) => {
        const result = event.target?.result as string;
        // Guardar base64 para enviar al backend
        this.imageBase64 = result;
        // Crear SafeUrl para mostrar el preview inmediato
        this.previewUrl = this.sanitizer.bypassSecurityTrustUrl(result);
      };
      reader.readAsDataURL(file);
    };

    input.click();
  }

  // ─── Navegación ───────────────────────────────────────────────────────────

  goBack(): void {
    this.router.navigate(['/organization-dashboard']);
  }

  // ─── Guardado ─────────────────────────────────────────────────────────────

  async onSave() {
    if (!this.profileForm.valid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.isSaving = true;
    const { name, email, centro, password } = this.profileForm.value;

    // Construir payload con solo los campos que tienen valor
    const payload: Record<string, string> = { name, email };
    if (centro?.trim())         payload['centro']   = centro.trim();
    if (this.imageBase64)       payload['image']    = this.imageBase64;
    if (password?.trim())       payload['password'] = password.trim();

    this.authService.updateMe(payload).subscribe({
      next: async () => {
        this.isSaving = false;
        const toast = await this.toastCtrl.create({
          message: 'Perfil actualizado correctamente',
          duration: 2000,
          color: 'success',
          position: 'top',
        });
        await toast.present();
        this.router.navigate(['/organization-dashboard']);
      },
      error: async (err) => {
        this.isSaving = false;
        const msg =
          err?.error?.error || err?.error?.message || 'Error al guardar el perfil';
        const toast = await this.toastCtrl.create({
          message: msg,
          duration: 3000,
          color: 'danger',
          position: 'top',
        });
        await toast.present();
      },
    });
  }
}
