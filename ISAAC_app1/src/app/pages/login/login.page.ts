import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BiometricAuthService } from '../../services/biometric-auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterModule],
})
export class LoginPage implements OnInit {
  loginForm!: FormGroup;
  isLoading         = false;
  biometricLoading  = false;
  errorMessage      = '';
  sessionExpired    = false;

  /** true si el dispositivo tiene biometría y el usuario la ha activado. */
  biometricEnabled  = false;
  /** true si hay biometría disponible (independientemente de si está activada). */
  biometricAvailable = false;

  constructor(
    private fb:           FormBuilder,
    private authService:  AuthService,
    private biometricSvc: BiometricAuthService,
    private router:       Router,
    private route:        ActivatedRoute,
    private toastCtrl:    ToastController,
    private alertCtrl:    AlertController,
  ) {}

  async ngOnInit() {
    this.sessionExpired = this.route.snapshot.queryParamMap.get('expired') === 'true';

    this.loginForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
    });

    // Si ya hay accessToken en memoria (raro, pero posible), redirigir directamente.
    if (this.authService.isLoggedIn()) {
      const user = this.authService.getCurrentUser();
      if (user) {
        this.router.navigate([this.authService.getRedirectRoute(user)], { replaceUrl: true });
        return;
      }
    }

    // Comprobar biometría disponible y activada.
    this.biometricAvailable = await this.biometricSvc.isAvailable();
    this.biometricEnabled   = this.biometricAvailable && await this.biometricSvc.isEnabled();
  }

  // ── Login biométrico ─────────────────────────────────────────────────────────

  async loginWithBiometric() {
    this.biometricLoading = true;
    this.errorMessage     = '';
    try {
      const refreshToken = await this.biometricSvc.authenticate();
      const user         = await this.authService.loginWithRefreshToken(refreshToken);
      this.router.navigate([this.authService.getRedirectRoute(user)], { replaceUrl: true });
    } catch {
      // El refreshToken puede estar revocado o el usuario canceló la biometría.
      // Desactivar para que en la próxima apertura se muestre solo el formulario.
      await this.biometricSvc.deactivate();
      this.biometricEnabled = false;
      this.errorMessage = 'No se pudo autenticar con biometría. Inicia sesión con tu contraseña.';
    } finally {
      this.biometricLoading = false;
    }
  }

  // ── Login con contraseña ─────────────────────────────────────────────────────

  async onSubmit() {
    if (!this.loginForm.valid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading      = true;
    this.errorMessage   = '';
    this.sessionExpired = false;

    this.authService.login(this.loginForm.value).subscribe({
      next: async response => {
        this.isLoading = false;
        const toast = await this.toastCtrl.create({
          message:  `Bienvenido, ${response.user.name}`,
          duration:  1500,
          color:    'success',
          position: 'top',
        });
        await toast.present();

        // Ofrecer activación biométrica si está disponible y no estaba ya activada.
        if (this.biometricAvailable && !this.biometricEnabled) {
          await this.offerBiometricActivation(response.refreshToken);
        }

        this.router.navigate([this.authService.getRedirectRoute(response.user)], { replaceUrl: true });
      },
      error: async err => {
        this.isLoading = false;
        this.errorMessage =
          err?.error?.error || err?.error?.message || 'Error al iniciar sesión. Revisa tus credenciales.';
        const toast = await this.toastCtrl.create({
          message:  this.errorMessage,
          duration:  2500,
          color:    'danger',
          position: 'top',
        });
        await toast.present();
      },
    });
  }

  // ── Activación biométrica ────────────────────────────────────────────────────

  private async offerBiometricActivation(refreshToken: string) {
    const alert = await this.alertCtrl.create({
      header:  'Acceso rápido',
      message: 'Usa Face ID, Touch ID o huella dactilar para entrar sin escribir la contraseña.',
      buttons: [
        { text: 'Ahora no', role: 'cancel' },
        {
          text: 'Activar',
          handler: () => {
            // El handler de Ionic no soporta async directamente; lanzamos la promise aparte.
            this.biometricSvc.activate(refreshToken)
              .then(() => { this.biometricEnabled = true; })
              .catch(() => { /* usuario canceló la biometría */ });
          },
        },
      ],
    });
    await alert.present();
    await alert.onDidDismiss();
  }
}
