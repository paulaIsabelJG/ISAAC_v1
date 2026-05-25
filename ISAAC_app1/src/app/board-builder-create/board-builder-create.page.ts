import { Component, OnInit } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UserService, BackendUser } from '../services/user.service';
import { BoardService, BoardShape } from '../services/board.service';

@Component({
  selector: 'app-board-builder-create',
  templateUrl: './board-builder-create.page.html',
  styleUrls: ['./board-builder-create.page.scss'],
  standalone: true,
  imports: [IonicModule, ReactiveFormsModule],
})
export class BoardBuilderCreatePage implements OnInit {

  private returnTo = '/board-builder';

  form!: FormGroup;
  isSaving = false;

  // Imagen de portada del tablero (opcional)
  imageB64:    string | null = null;
  imageSafeUrl: SafeUrl | null = null;

  // Usuarios finales del centro para el selector
  centerUsers: BackendUser[] = [];
  usersLoading = false;
  usersError   = '';

  // Forma seleccionada (para mostrar/ocultar campos)
  get selectedShape(): BoardShape {
    return this.form?.get('shape')?.value ?? 'grid';
  }

  get predictorEnabled(): boolean {
    return !!this.form?.get('predictorEnabled')?.value;
  }

  get locationColumnEnabled(): boolean {
    return !!this.form?.get('locationColumnEnabled')?.value;
  }

  get creatorName(): string {
    return this.authSvc.getCurrentUser()?.name ?? '';
  }

  constructor(
    private route:     ActivatedRoute,
    private router:    Router,
    private fb:        FormBuilder,
    private authSvc:   AuthService,
    private userSvc:   UserService,
    private boardSvc:  BoardService,
    private toastCtrl: ToastController,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit() {
    const rt = this.route.snapshot.queryParamMap.get('returnTo');
    if (rt) { this.returnTo = rt; }

    this.form = this.fb.group({
      name:                   ['', [Validators.required, Validators.minLength(2)]],
      userId:                 ['', Validators.required],
      shape:                  ['grid'],
      rows:                   [3,  [Validators.required, Validators.min(1), Validators.max(10)]],
      columns:                [4,  [Validators.required, Validators.min(1), Validators.max(10)]],
      circleSlots:            [8,  [Validators.required, Validators.min(3), Validators.max(20)]],
      locationColumnEnabled:  [false],
      locationColumnSlots:    [6,  [Validators.min(1), Validators.max(20)]],
      predictorEnabled:       [false],
      aiRewriteEnabled:       [false],
      iaRows:                 [5,  [Validators.min(1), Validators.max(20)]],
      iaCols:                 [1,  [Validators.min(1), Validators.max(5)]],
    });
  }

  ionViewWillEnter() {
    this.loadCenterUsers();
  }

  // ── Carga ────────────────────────────────────────────────────────────────────

  private async loadCenterUsers(): Promise<void> {
    const org = this.authSvc.getCurrentUser();
    if (!org?.centro) {
      this.usersError = 'No se encontró el centro de la organización.';
      return;
    }
    this.usersLoading = true;
    this.usersError   = '';
    try {
      const res = await firstValueFrom(this.userSvc.getUsersByCenter(org.centro));
      this.centerUsers = res.users.filter((u) => u.type === 'user');
    } catch {
      this.usersError = 'Error al cargar los usuarios.';
    } finally {
      this.usersLoading = false;
    }
  }

  // ── Crear tablero ─────────────────────────────────────────────────────────────

  // ── Imagen de portada ─────────────────────────────────────────────────────────

  pickImage(): void {
    const input   = document.createElement('input');
    input.type    = 'file';
    input.accept  = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        (await this.toastCtrl.create({
          message: 'La imagen supera 2 MB', duration: 2500, color: 'warning', position: 'top',
        })).present();
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const b64         = ev.target!.result as string;
        this.imageB64     = b64;
        this.imageSafeUrl = this.sanitizer.bypassSecurityTrustUrl(b64);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  removeImage(): void {
    this.imageB64     = null;
    this.imageSafeUrl = null;
  }

  // ── Crear tablero ─────────────────────────────────────────────────────────────

  async create(): Promise<void> {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    const {
      name, userId, shape, rows, columns,
      circleSlots, locationColumnEnabled, locationColumnSlots,
      predictorEnabled, aiRewriteEnabled, iaRows, iaCols,
    } = this.form.value;

    this.isSaving = true;
    try {
      const res = await firstValueFrom(
        this.boardSvc.createBoard({
          name, userId, shape,
          rows, columns,
          circleSlots,
          locationColumnEnabled,
          locationColumnSlots,
          predictorEnabled, aiRewriteEnabled,
          iaRows, iaCols,
          imageUrl: this.imageB64 ?? '',
        })
      );
      (await this.toastCtrl.create({
        message: '✓ Tablero creado', duration: 1800, color: 'success', position: 'top',
      })).present();
      this.router.navigate(['/board-builder-editor', res.board._id], {
        queryParams: { returnTo: '/board-builder' },
      });
    } catch (err: any) {
      (await this.toastCtrl.create({
        message:  err?.error?.error || 'Error al crear el tablero',
        duration: 3000, color: 'danger', position: 'top',
      })).present();
    } finally {
      this.isSaving = false;
    }
  }

  // ── Navegación ────────────────────────────────────────────────────────────────

  goBack() { this.router.navigateByUrl(this.returnTo); }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  onUserSelect(event: Event) {
    const val = (event as CustomEvent<{ value: string }>).detail.value;
    this.form.get('userId')!.setValue(val);
  }

  onShapeSelect(event: Event) {
    const val = (event as CustomEvent<{ value: string }>).detail.value;
    this.form.get('shape')!.setValue(val);
  }
}
