import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { UserService, FullBackendUser } from '../services/user.service';
import { LoadingErrorStateComponent } from '../shared/components/loading-error-state/loading-error-state.component';

const MAX_IMG = 2 * 1024 * 1024; // 2 MB

@Component({
  selector: 'app-user-personal-data',
  templateUrl: './user-personal-data.page.html',
  styleUrls:  ['./user-personal-data.page.scss'],
  standalone: true,
  imports: [ReactiveFormsModule, IonicModule, LoadingErrorStateComponent],
})
export class UserPersonalDataPage implements OnInit {

  userId     = '';
  targetUser: FullBackendUser | null = null;

  form!: FormGroup;

  // Imagen
  imgB64: string | null = null;
  imgUrl: SafeUrl | null = null;

  isLoading = true;
  isSaving  = false;
  loadError = '';

  constructor(
    private route:      ActivatedRoute,
    private router:     Router,
    private fb:         FormBuilder,
    private userSvc:    UserService,
    private toastCtrl:  ToastController,
    private sanitizer:  DomSanitizer,
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

      // Separar nombre y apellidos almacenados como "nombre apellidos"
      const parts   = res.user.name.trim().split(/\s+/);
      const name    = parts[0] ?? '';
      const surname = parts.slice(1).join(' ');

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
    } catch {
      this.loadError = 'Error al cargar los datos del usuario.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Imagen ──────────────────────────────────────────────────────────────────

  pickImage() {
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
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.isSaving = true;

    const { name, surname, gender } = this.form.getRawValue();
    const fullName = [name.trim(), surname?.trim()].filter(Boolean).join(' ');

    try {
      await firstValueFrom(
        this.userSvc.updateUserById(this.userId, {
          name:   fullName,
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

  goBack() {
    this.router.navigate(['/user-session', this.userId]);
  }
}
