import { Component, OnInit } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UserService, BackendUser } from '../../services/user.service';
import { BoardService } from '../../services/board.service';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';

@Component({
  selector: 'app-board-builder-create',
  templateUrl: './board-builder-create.page.html',
  styleUrls: ['./board-builder-create.page.scss'],
  standalone: true,
  imports: [IonicModule, ReactiveFormsModule, AppPageHeaderComponent],
})
export class BoardBuilderCreatePage implements OnInit {

  private returnTo = '/board-builder';

  form!: FormGroup;
  isSaving = false;

  /** Contexto del builder: ID y nombre del creador para el que se va a crear el tablero. */
  contextCreatorId   = '';
  contextCreatorName = '';

  // Imagen de portada del tablero (opcional)
  imageB64:    string | null = null;
  imageSafeUrl: SafeUrl | null = null;

  // Usuarios finales del centro para el selector
  centerUsers: BackendUser[] = [];
  usersLoading = false;
  usersError   = '';

  // Selección multi-usuario (reemplaza el campo userId del formulario)
  cfgAssignedUserIds: string[] = [];
  // IDs pre-seleccionados recibidos del editor; se aplican tras cargar la lista del centro
  private preselectedAssignedUserIds: string[] = [];

  // ── Tipo de tablero ───────────────────────────────────────────────────────────
  /** Rol del tablero a crear. Leído de query param en ionViewWillEnter (no ngOnInit,
   *  para sobrevivir al component-caching de Ionic). */
  cfgBoardRole:  'main' | 'secondary' = 'main';
  /** true → el selector de tipo está deshabilitado (viene de editor, siempre secondary) */
  lockBoardRole = false;

  // ── Multitablero ──────────────────────────────────────────────────────────────
  cfgSlotCount: 2 | 3 | 4 = 2;

  // ── Link-back: flujo "Crear nuevo tablero" iniciado desde una celda ───────────
  /** true → los usuarios vienen fijados desde el editor y no se pueden cambiar */
  lockAssignedUsers = false;
  /** true → al crear hay que volver al editor con los params de enlace */
  linkBack          = false;
  private sourceBoardId    = '';
  private sourceCellRow    = -1;
  private sourceCellCol    = -1;
  private sourceActionType = 'navigate';

  /** Nombres de los usuarios bloqueados (para mostrar en UI read-only). */
  get lockedUserNames(): string {
    if (!this.centerUsers.length) {
      return `${this.cfgAssignedUserIds.length} usuario(s)`;
    }
    const names = this.cfgAssignedUserIds
      .map((id) => this.centerUsers.find((u) => u._id === id)?.name ?? id)
      .join(', ');
    return names || `${this.cfgAssignedUserIds.length} usuario(s)`;
  }

  // Forma seleccionada (para mostrar/ocultar campos)
  get selectedShape(): string {
    return this.form?.get('shape')?.value ?? 'grid';
  }

  get isMultiBoard(): boolean {
    return this.selectedShape === 'multi';
  }

  get predictorEnabled(): boolean {
    return !!this.form?.get('predictorEnabled')?.value;
  }

  get locationColumnEnabled(): boolean {
    return !!this.form?.get('locationColumnEnabled')?.value;
  }

  get isPredictiveCircularChecked(): boolean {
    return !!this.form?.get('isPredictiveCircular')?.value;
  }

  /** Nombre del creador a mostrar en el formulario (contexto, no sesión). */
  get creatorName(): string {
    return this.contextCreatorName || this.authSvc.getCurrentUser()?.name || '';
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
    // Solo creamos la estructura del formulario.
    // Los VALORES (contexto, boardRole, shape…) se aplican en ionViewWillEnter → syncFromQueryParams()
    // para que sean correctos también cuando Ionic reutiliza el componente cacheado.
    this.form = this.fb.group({
      name:                   ['', [Validators.required, Validators.minLength(2)]],
      userId:                 [''],   // campo legacy; la validación real usa cfgAssignedUserIds
      shape:                  ['grid'],
      rows:                   [3,  [Validators.required, Validators.min(1), Validators.max(10)]],
      columns:                [4,  [Validators.required, Validators.min(1), Validators.max(10)]],
      circleSlots:            [8,  [Validators.required, Validators.min(3), Validators.max(20)]],
      locationColumnEnabled:  [false],
      locationColumnSlots:    [6,  [Validators.min(1), Validators.max(20)]],
      predictorEnabled:       [false],
      aiRewriteEnabled:       [false],
      autoPersonalize:        [false],
      iaRows:                 [5,  [Validators.min(1), Validators.max(20)]],
      iaCols:                 [1,  [Validators.min(1), Validators.max(5)]],
      isPredictiveCircular:   [false],
    });
  }

  ionViewWillEnter() {
    // Leer params y resetear formulario en CADA entrada de página.
    // ngOnInit solo corre una vez; si Ionic cachea el componente los datos del
    // viaje anterior persisten → boardRole quedaría en 'main', el formulario
    // retendría nombre/imagen del tablero anterior.
    this.syncFromQueryParams();
    this.loadCenterUsers();
  }

  // ── Contexto y reset ─────────────────────────────────────────────────────────

  /** Sincroniza todos los query params y resetea el formulario a valores limpios.
   *  Se llama en ionViewWillEnter para ser idempotente aunque el componente esté cacheado. */
  private syncFromQueryParams(): void {
    const q = this.route.snapshot.queryParamMap;

    // ── Contexto heredado del editor ────────────────────────────────────────
    const rt = q.get('returnTo');
    if (rt) { this.returnTo = rt; }

    const me = this.authSvc.getCurrentUser();
    this.contextCreatorId   = q.get('creatorId')   || me?.id   || '';
    this.contextCreatorName = q.get('creatorName')  || me?.name || '';

    // Tipo de tablero (boardRole): solo main o secondary
    const qBoardRole   = q.get('boardRole');
    this.cfgBoardRole  = qBoardRole === 'secondary' ? 'secondary' : 'main';
    this.lockBoardRole = q.get('lockBoardRole') === 'true';
    this.cfgSlotCount  = 2;

    // Usuarios asignados
    const qAssignedUserIds = q.get('assignedUserIds');
    this.preselectedAssignedUserIds = qAssignedUserIds
      ? qAssignedUserIds.split(',').filter(Boolean)
      : [];
    // lockAssignedUsers puede venir explícito o implícito si linkBack=true
    this.lockAssignedUsers =
      q.get('lockAssignedUsers') === 'true' || q.get('linkBack') === 'true';
    // Vaciar selección — loadCenterUsers la rellenará con la preselección validada
    this.cfgAssignedUserIds = [];

    // Link-back
    const qLinkBack = q.get('linkBack');
    this.linkBack = qLinkBack === 'true';
    if (this.linkBack) {
      this.sourceCellRow    = Number(q.get('sourceCellRow')    ?? '-1');
      this.sourceCellCol    = Number(q.get('sourceCellCol')    ?? '-1');
      this.sourceActionType = q.get('sourceActionType')        ?? 'navigate';
      // sourceBoardId: viene directo como param o se extrae del returnTo
      this.sourceBoardId = q.get('sourceBoardId') ?? '';
      if (!this.sourceBoardId) {
        const m = (this.returnTo || '').match(/\/board-builder-editor\/([^/?]+)/);
        this.sourceBoardId = m?.[1] ?? '';
      }
    } else {
      this.sourceBoardId    = '';
      this.sourceCellRow    = -1;
      this.sourceCellCol    = -1;
      this.sourceActionType = 'navigate';
    }

    // ── Datos del formulario: siempre limpios (NO copiar del tablero origen) ──
    this.imageB64     = null;
    this.imageSafeUrl = null;

    const qShape = q.get('shape');
    const initialShape = qShape === 'multi'    ? 'multi'
                       : qShape === 'circular' ? 'circular'
                       : 'grid';
    this.form.reset({
      name:                  '',
      userId:                '',
      shape:                 initialShape,
      rows:                  3,
      columns:               4,
      circleSlots:           8,
      locationColumnEnabled: false,
      locationColumnSlots:   6,
      predictorEnabled:      false,
      aiRewriteEnabled:      false,
      autoPersonalize:       false,
      iaRows:                5,
      iaCols:                1,
      isPredictiveCircular:  false,
    });

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

      // Aplicar pre-selección de usuarios (validada contra la lista real del centro)
      if (this.preselectedAssignedUserIds.length > 0) {
        const validIds = new Set(this.centerUsers.map((u) => u._id));
        this.cfgAssignedUserIds = this.preselectedAssignedUserIds.filter((id) =>
          validIds.has(id)
        );
      }
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

    // Los tableros secundarios pueden crearse sin usuario asignado (lo heredarán al enlazarse)
    if (this.cfgBoardRole !== 'secondary' && this.cfgAssignedUserIds.length === 0) {
      (await this.toastCtrl.create({
        message: 'Selecciona al menos un usuario asignado.',
        duration: 2200, color: 'warning', position: 'top',
      })).present();
      return;
    }

    const {
      name, shape, rows, columns,
      circleSlots, locationColumnEnabled, locationColumnSlots,
      predictorEnabled, aiRewriteEnabled, autoPersonalize, iaRows, iaCols,
      isPredictiveCircular,
    } = this.form.value;

    const userId = this.cfgAssignedUserIds[0];

    this.isSaving = true;
    try {
      const isMulti = this.isMultiBoard;
      const res = await firstValueFrom(
        this.boardSvc.createBoard({
          name, userId,
          shape:   shape as import('../../services/board.service').BoardShape,
          rows:    isMulti ? 1 : rows,
          columns: isMulti ? 1 : columns,
          circleSlots,
          locationColumnEnabled,
          locationColumnSlots,
          predictorEnabled, aiRewriteEnabled, autoPersonalize,
          iaRows, iaCols,
          imageUrl:         this.imageB64 ?? '',
          assignedUserIds:  this.cfgAssignedUserIds,
          boardRole:        this.cfgBoardRole,
          contextCreatorId: this.contextCreatorId || undefined,
          // Circular predictivo
          ...(shape === 'circular' ? {
            isPredictiveCircular: !!isPredictiveCircular,
            ...(isPredictiveCircular ? {
              predictiveCircularConfig: { suggestionsPerCategory: 8, categories: [] },
            } : {}),
          } : {}),
          // Multitablero
          ...(isMulti ? {
            slotCount:       this.cfgSlotCount,
            multiBoardSlots: [],
          } : {}),
        })
      );
      (await this.toastCtrl.create({
        message: '✓ Tablero creado', duration: 1800, color: 'success', position: 'top',
      })).present();

      if (this.linkBack && this.sourceBoardId) {
        // Volver al editor de origen con los params de enlace para que asigne
        // automáticamente el nuevo tablero como destino de la celda seleccionada.
        this.router.navigate(['/board-builder-editor', this.sourceBoardId], {
          queryParams: {
            creatorId:                 this.contextCreatorId   || null,
            creatorName:               this.contextCreatorName || null,
            linkCreatedBoard:          'true',
            newlyCreatedTargetBoardId: res.board._id,
            sourceCellRow:             this.sourceCellRow,
            sourceCellCol:             this.sourceCellCol,
            sourceActionType:          this.sourceActionType,
          },
        });
      } else {
        this.router.navigate(['/board-builder-editor', res.board._id], {
          queryParams: {
            returnTo:    this.returnTo,
            creatorId:   this.contextCreatorId,
            creatorName: this.contextCreatorName,
          },
        });
      }
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

  onUserMultiSelect(event: Event) {
    const values: string[] =
      (event as CustomEvent<{ value: string[] }>).detail.value ?? [];
    this.cfgAssignedUserIds = values;
    // Sync legacy field
    this.form.get('userId')!.setValue(values[0] ?? '');
  }

  /** Selecciona todos los usuarios del centro. */
  selectAllUsers(): void {
    this.cfgAssignedUserIds = this.centerUsers.map((u) => u._id);
    this.form.get('userId')!.setValue(this.cfgAssignedUserIds[0] ?? '');
  }

  onShapeSelect(event: Event) {
    const val = (event as CustomEvent<{ value: string }>).detail.value;
    this.form.get('shape')!.setValue(val);
  }
}
