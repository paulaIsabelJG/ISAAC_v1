import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterModule],
})
export class LoginPage implements OnInit {
  loginForm!: FormGroup;
  isLoading = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    // Si ya hay sesión activa, redirigir directamente al dashboard
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

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.login(this.loginForm.value).subscribe({
      next: async (response) => {
        this.isLoading = false;
        const toast = await this.toastCtrl.create({
          message: `Bienvenido, ${response.user.name}`,
          duration: 1500,
          color: 'success',
          position: 'top',
        });
        await toast.present();
        // Navegar según tipo de usuario (saveSession ya fue llamado via tap() en el servicio)
        this.router.navigate([this.authService.getRedirectRoute(response.user)], { replaceUrl: true });
      },
      error: async (err) => {
        this.isLoading = false;
        this.errorMessage =
          err?.error?.error || err?.error?.message || 'Error al iniciar sesión. Revisa tus credenciales.';
        const toast = await this.toastCtrl.create({
          message: this.errorMessage,
          duration: 2500,
          color: 'danger',
          position: 'top',
        });
        await toast.present();
      },
    });
  }
}
