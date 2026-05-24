import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { AuthService, AddressSuggestion } from '../services/auth.service';

type View = 'select' | 'professional' | 'final-user' | 'family';

const MAX_IMG = 2 * 1024 * 1024; // 2 MB

@Component({
  selector: 'app-add-user',
  templateUrl: './add-user.page.html',
  styleUrls: ['./add-user.page.scss'],
  standalone: true,
  imports: [ReactiveFormsModule, IonicModule],
})
export class AddUserPage implements OnInit {

  // ── Vista activa ────────────────────────────────────────────────────
  view: View = 'select';
  isSaving   = false;

  // ── Formularios ─────────────────────────────────────────────────────
  profForm!:  FormGroup;
  finalForm!: FormGroup;
  famForm!:   FormGroup;

  // ── Toggle contraseñas ──────────────────────────────────────────────
  showProfPwd  = false;
  showFinalPwd = false;
  showFamPwd   = false;

  // ── Imágenes ────────────────────────────────────────────────────────
  profImgB64:  string | null = null;  profImgUrl:  SafeUrl | null = null;
  finalImgB64: string | null = null;  finalImgUrl: SafeUrl | null = null;
  famImgB64:   string | null = null;  famImgUrl:   SafeUrl | null = null;

  // ── Usuario final: extras ────────────────────────────────────────────
  soundEnabled = true;
  perms = { editData: false, editBoards: false, editStats: false };

  // ── Autocompletado de dirección ──────────────────────────────────────
  suggestions:    AddressSuggestion[] = [];
  showSuggestions = false;
  private _lat: number | null = null;
  private _lng: number | null = null;
  private _city:    string | null = null;
  private _country: string | null = null;
  private _deb: ReturnType<typeof setTimeout> | null = null;

  get headerTitle(): string {
    return ({
      select:       'Agregar usuario',
      professional: 'Nuevo profesional',
      'final-user': 'Nuevo usuario final',
      family:       'Nuevo familiar',
    } as Record<View, string>)[this.view];
  }

  constructor(
    private fb:        FormBuilder,
    private authSvc:   AuthService,
    private router:    Router,
    private toastCtrl: ToastController,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit() {
    this.profForm = this.fb.group({
      email:            ['', [Validators.required, Validators.email]],
      password:         ['', [Validators.required, Validators.minLength(6)]],
      name:             ['', [Validators.required, Validators.minLength(2)]],
      surname:          ['', Validators.required],
      phone:            [''],
      professionalType: ['Terapeuta'],
    });

    this.finalForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      name:     ['', [Validators.required, Validators.minLength(2)]],
      surname:  ['', Validators.required],
      age:      [null],
      gender:   ['prefer_not_to_say'],
      address:  [''],
    });

    this.famForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  // ── Navegación ───────────────────────────────────────────────────────
  goBack() {
    this.view === 'select'
      ? this.router.navigate(['/organization-dashboard'])
      : (this.view = 'select');
  }

  setView(v: View) { this.view = v; }

  goOwnPictograms()         { this.router.navigate(['/own-pictograms-placeholder']); }
  goAssignedProfessionals() { this.router.navigate(['/assigned-professionals-placeholder']); }

  // ── Selector de imagen ───────────────────────────────────────────────
  pickImage(target: 'prof' | 'final' | 'fam') {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';

    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (file.size > MAX_IMG) {
        const t = await this.toastCtrl.create({
          message: 'La imagen supera 2 MB', duration: 2500, color: 'warning', position: 'top',
        });
        await t.present();
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const b64  = ev.target!.result as string;
        const safe = this.sanitizer.bypassSecurityTrustUrl(b64);
        if (target === 'prof')  { this.profImgB64  = b64; this.profImgUrl  = safe; }
        if (target === 'final') { this.finalImgB64 = b64; this.finalImgUrl = safe; }
        if (target === 'fam')   { this.famImgB64   = b64; this.famImgUrl   = safe; }
      };
      reader.readAsDataURL(file);
    };

    input.click();
  }

  // ── Sonido ───────────────────────────────────────────────────────────
  toggleSound() { this.soundEnabled = !this.soundEnabled; }

  // ── Autocompletado de dirección ──────────────────────────────────────
  onAddressInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this._lat = this._lng = this._city = this._country = null;
    if (this._deb) clearTimeout(this._deb);
    if (val.length < 3) { this.suggestions = []; this.showSuggestions = false; return; }
    this._deb = setTimeout(() => {
      this.authSvc.getPlaceSuggestions(val).subscribe({
        next: r  => { this.suggestions = r.suggestions; this.showSuggestions = r.suggestions.length > 0; },
        error: () => { this.suggestions = []; this.showSuggestions = false; },
      });
    }, 300);
  }

  selectSuggestion(s: AddressSuggestion) {
    this.finalForm.get('address')!.setValue(s.formattedAddress);
    this._lat = s.lat; this._lng = s.lng; this._city = s.city; this._country = s.country;
    this.showSuggestions = false; this.suggestions = [];
  }

  closeSuggestions() { setTimeout(() => { this.showSuggestions = false; }, 150); }

  // ── Guardar: Profesional ─────────────────────────────────────────────
  async saveProfessional() {
    if (this.profForm.invalid) { this.profForm.markAllAsTouched(); return; }
    this.isSaving = true;
    const { email, password, name, surname } = this.profForm.value;
    const org = this.authSvc.getCurrentUser();

    this.authSvc.register({
      email, password,
      name:   [name, surname].filter(Boolean).join(' '),
      type:   'teacher',
      centro: org?.centro || 'Centro ISAAC',
      image:  this.profImgB64 ?? undefined,
    }).subscribe({
      next: async () => {
        this.isSaving = false;
        (await this.toastCtrl.create({ message: '✓ Profesional añadido', duration: 2000, color: 'success', position: 'top' })).present();
        this.view = 'select';
        this.profForm.reset({ professionalType: 'Terapeuta' });
        this.profImgB64 = null; this.profImgUrl = null;
      },
      error: async err => {
        this.isSaving = false;
        (await this.toastCtrl.create({ message: err?.error?.error || 'Error al añadir profesional', duration: 3000, color: 'danger', position: 'top' })).present();
      },
    });
  }

  // ── Guardar: Usuario final ───────────────────────────────────────────
  async saveFinalUser() {
    if (this.finalForm.invalid) { this.finalForm.markAllAsTouched(); return; }
    this.isSaving = true;
    const { email, password, name, surname, gender, address } = this.finalForm.value;
    const org = this.authSvc.getCurrentUser();

    this.authSvc.register({
      email, password,
      name:   [name, surname].filter(Boolean).join(' '),
      type:   'user',
      gender,
      centro: address?.trim() || org?.centro || 'Centro ISAAC',
      image:  this.finalImgB64 ?? undefined,
    }).subscribe({
      next: async () => {
        this.isSaving = false;
        (await this.toastCtrl.create({ message: '✓ Usuario añadido', duration: 2000, color: 'success', position: 'top' })).present();
        this.view = 'select';
        this.finalForm.reset({ gender: 'prefer_not_to_say' });
        this.finalImgB64 = null; this.finalImgUrl = null;
        this._lat = this._lng = null;
        this.perms = { editData: false, editBoards: false, editStats: false };
      },
      error: async err => {
        this.isSaving = false;
        (await this.toastCtrl.create({ message: err?.error?.error || 'Error al añadir usuario', duration: 3000, color: 'danger', position: 'top' })).present();
      },
    });
  }

  // ── Guardar: Familiar ────────────────────────────────────────────────
  async saveFamily() {
    if (this.famForm.invalid) { this.famForm.markAllAsTouched(); return; }
    this.isSaving = true;
    const { email, password } = this.famForm.value;

    this.authSvc.register({
      email, password,
      name:  email.split('@')[0],
      type:  'parent',
      image: this.famImgB64 ?? undefined,
    }).subscribe({
      next: async () => {
        this.isSaving = false;
        (await this.toastCtrl.create({ message: '✓ Familiar añadido', duration: 2000, color: 'success', position: 'top' })).present();
        this.view = 'select';
        this.famForm.reset();
        this.famImgB64 = null; this.famImgUrl = null;
      },
      error: async err => {
        this.isSaving = false;
        (await this.toastCtrl.create({ message: err?.error?.error || 'Error al añadir familiar', duration: 3000, color: 'danger', position: 'top' })).present();
      },
    });
  }
}
