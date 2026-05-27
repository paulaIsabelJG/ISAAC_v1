import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

// ─── Validator de contraseñas ─────────────────────────────────────────────────
const passwordMatchValidator: ValidatorFn = (
  group: AbstractControl
): ValidationErrors | null => {
  const pass    = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return pass && confirm && pass !== confirm ? { passwordMismatch: true } : null;
};

// ─── Tipos disponibles en el registro público ─────────────────────────────────
type AccountType = 'teacher' | 'user';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterModule],
})
export class RegisterPage implements OnInit {
  registerForm!: FormGroup;
  isLoading = false;

  /** Tipo de cuenta seleccionado por el usuario */
  accountType: AccountType = 'teacher';

  /** Estado de visibilidad de las contraseñas */
  showPassword        = false;
  showConfirmPassword = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.registerForm = this.fb.group(
      {
        // Solo para teacher
        orgName:   [''],
        // Solo para user (independiente)
        firstName: [''],
        lastName:  [''],
        // Comunes
        email:          ['', [Validators.required, Validators.email]],
        password:       ['', [Validators.required, Validators.minLength(6)]],
        confirmPassword:['', Validators.required],
      },
      { validators: passwordMatchValidator }
    );

    // Iniciar con tipo teacher y activar sus validadores
    this.applyValidatorsForType('teacher');
  }

  // ─── Selección de tipo de cuenta ─────────────────────────────────────────────

  selectType(type: AccountType): void {
    this.accountType = type;
    this.applyValidatorsForType(type);
    // Limpiar campos del tipo anterior para no mandar datos residuales
    this.registerForm.patchValue({ orgName: '', firstName: '', lastName: '' });
  }

  private applyValidatorsForType(type: AccountType): void {
    const orgName   = this.registerForm.get('orgName')!;
    const firstName = this.registerForm.get('firstName')!;
    const lastName  = this.registerForm.get('lastName')!;

    if (type === 'teacher') {
      orgName.setValidators([Validators.required, Validators.minLength(2)]);
      firstName.clearValidators();
      lastName.clearValidators();
    } else {
      // user (independiente)
      orgName.clearValidators();
      firstName.setValidators([Validators.required, Validators.minLength(2)]);
      lastName.setValidators([Validators.required, Validators.minLength(2)]);
    }

    orgName.updateValueAndValidity();
    firstName.updateValueAndValidity();
    lastName.updateValueAndValidity();
    this.registerForm.updateValueAndValidity();
  }

  // ─── Visibilidad de contraseñas ───────────────────────────────────────────────

  togglePassword()        { this.showPassword        = !this.showPassword;        }
  toggleConfirmPassword() { this.showConfirmPassword = !this.showConfirmPassword; }

  // ─── Helper de validación ─────────────────────────────────────────────────────

  /** True cuando las contraseñas no coinciden y el campo confirmPassword fue tocado */
  get passwordMismatch(): boolean {
    return (
      this.registerForm.hasError('passwordMismatch') &&
      (this.registerForm.get('confirmPassword')?.touched ?? false)
    );
  }

  // ─── Envío ────────────────────────────────────────────────────────────────────

  async onSubmit() {
    if (!this.registerForm.valid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;

    const { orgName, firstName, lastName, email, password } = this.registerForm.value;

    let name: string;
    let centro: string;

    if (this.accountType === 'teacher') {
      // La organización usa su propio nombre como 'centro'
      name   = (orgName as string).trim();
      centro = name;
    } else {
      // Usuario independiente: nombre + apellidos; centro = 'Independiente'
      name   = `${(firstName as string).trim()} ${(lastName as string).trim()}`.trim();
      centro = 'Independiente';
    }

    this.authService
      .register({ name, email, password, type: this.accountType, centro })
      .subscribe({
        next: async () => {
          this.isLoading = false;
          const toast = await this.toastCtrl.create({
            message: '¡Registro exitoso! Inicia sesión para continuar.',
            duration: 2500,
            color: 'success',
            position: 'top',
          });
          await toast.present();
          this.router.navigate(['/login']);
        },
        error: async (err) => {
          this.isLoading = false;
          const msg =
            err?.error?.error ||
            err?.error?.message ||
            'Error al registrarse. Inténtalo de nuevo.';
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
