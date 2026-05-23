import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { IonicModule, ModalController, AlertController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { AuthService, RegisterPayload } from '../services/auth.service';

interface CustomPictogram {
  id: string;
  label: string;
  imageUrl: string;
}

interface RegisterForm {
  name: string;
  email: string;
  password: string;
  type: 'teacher' | 'parent' | 'user';
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  image: string;
  customPictograms: CustomPictogram[];
}

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule]
})
export class RegisterPage implements OnInit {
  registerForm!: FormGroup;
  isLoading = false;

  constructor(
    private fb: FormBuilder,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.registerForm = this.fb.group({
      name: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      type: ['user', [Validators.required]],
      gender: ['prefer_not_to_say', [Validators.required]],
      image: [''],
      customPictograms: this.fb.array([])
    });
  }

  get customPictograms(): FormArray {
    return this.registerForm.get('customPictograms') as FormArray;
  }

  async addCustomPictogram() {
    const alert = await this.alertCtrl.create({
      header: 'Add Custom Pictogram',
      inputs: [
        {
          name: 'id',
          type: 'text',
          placeholder: 'ID (e.g., custom-1)',
          attributes: {
            required: true
          }
        },
        {
          name: 'label',
          type: 'text',
          placeholder: 'Label',
          attributes: {
            required: true
          }
        },
        {
          name: 'imageUrl',
          type: 'url',
          placeholder: 'Image URL',
          attributes: {
            required: true
          }
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Add',
          handler: (data) => {
            if (data.id && data.label && data.imageUrl) {
              this.customPictograms.push(this.fb.group({
                id: [data.id],
                label: [data.label],
                imageUrl: [data.imageUrl]
              }));
            }
          }
        }
      ]
    });

    await alert.present();
  }

  removeCustomPictogram(index: number) {
    this.customPictograms.removeAt(index);
  }

  async onSubmit() {
    if (this.registerForm.valid) {
      this.isLoading = true;
      const formValue: RegisterPayload = this.registerForm.value;

      this.authService.register(formValue).subscribe({
        next: async (response) => {
          this.isLoading = false;
          const toast = await this.toastCtrl.create({
            message: 'Registration successful!',
            duration: 2000,
            color: 'success'
          });
          await toast.present();
          this.router.navigate(['/home']);
        },
        error: async (error) => {
          this.isLoading = false;
          const toast = await this.toastCtrl.create({
            message: 'Registration failed. Please try again.',
            duration: 2000,
            color: 'danger'
          });
          await toast.present();
        }
      });
    } else {
      // Mark all fields as touched to show validation errors
      this.registerForm.markAllAsTouched();
    }
  }
}