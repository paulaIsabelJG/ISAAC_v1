import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterModule],
})
export class LoginPage implements OnInit {
  loginForm!: FormGroup;
  isLoading      = false;
  errorMessage   = '';
  /** true cuando se llega desde una sesión caducada (?expired=true en la URL) */
  sessionExpired = false;

  constructor(
    private fb:          FormBuilder,
    private authService: AuthService,
    private router:      Router,
    private route:       ActivatedRoute,
    private toastCtrl:   ToastController,
  ) {}

  ngOnInit() {
    // Detectar si venimos de una sesión caducada (guard o interceptor)
    this.sessionExpired = this.route.snapshot.queryParamMap.get('expired') === 'true';

    // Si ya hay sesión activa y válida, redirigir directamente
    if (this.authService.isLoggedIn()) {
      const user = this.authService.getCurrentUser();
      if (user) {
        this.router.navigate([this.authService.getRedirectRoute(user)], { replaceUrl: true });
        return;
      }
    }

    this.loginForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
    });
  }

  async onSubmit() {
    if (!this.loginForm.valid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading      = true;
    this.errorMessage   = '';
    this.sessionExpired = false; // Ocultar el banner al intentar de nuevo

    this.authService.login(this.loginForm.value).subscribe({
      next: async (response) => {
        this.isLoading = false;
        const toast = await this.toastCtrl.create({
          message:  `Bienvenido, ${response.user.name}`,
          duration:  1500,
          color:    'success',
          position: 'top',
        });
        await toast.present();
        this.router.navigate([this.authService.getRedirectRoute(response.user)], { replaceUrl: true });
      },
      error: async (err) => {
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
}
