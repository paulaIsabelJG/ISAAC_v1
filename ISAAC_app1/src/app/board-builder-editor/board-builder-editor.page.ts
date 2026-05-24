import { Component, OnInit } from '@angular/core';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UserService, BackendUser, BackendPictogram, AddPictogramPayload } from '../services/user.service';
import {
  BoardService, Board, BoardCell, CellPictogram, CellAction,
  WordType, ActionType, FITZGERALD, WORD_TYPE_LABELS,
} from '../services/board.service';

// ─── Resultado de búsqueda ARASAAC ───────────────────────────────────────────
interface ArasaacResult {
  id:       string | number;
  label:    string;
  imageUrl: string;
  keywords: string[];
}

// ─── Forma de la columna derecha ──────────────────────────────────────────────
interface PictForm {
  source:            'arasaac' | 'custom' | 'new';
  id:                string;
  label:             string;
  sound:             string;
  imageUrl:          string;
  tags:              string;  // coma-separado en UI, array al guardar
  description:       string;
  wordType:          WordType;
  fitzgeraldEnabled: boolean;
  color:             string;
}

interface ActionForm {
  type:          ActionType;
  targetBoardId: string;
}

@Component({
  selector:    'app-board-builder-editor',
  templateUrl: './board-builder-editor.page.html',
  styleUrls:   ['./board-builder-editor.page.scss'],
  standalone:  true,
  imports:     [IonicModule, FormsModule],
})
export class BoardBuilderEditorPage implements OnInit {

  // ── Routing ─────────────────────────────────────────────────────────────────
  boardId   = '';
  returnTo  = '/board-builder';

  // ── Estado principal ─────────────────────────────────────────────────────────
  board:     Board | null = null;
  isLoading  = true;
  isSaving   = false;
  loadError  = '';

  // ── Vista previa ─────────────────────────────────────────────────────────────
  previewMode = false;
  aacPhrase:  CellPictogram[] = [];

  // ── Celda seleccionada ───────────────────────────────────────────────────────
  selectedCell: { row: number; col: number } | null = null;
  isEditingCell = false;   // true cuando la celda seleccionada ya tiene pictograma

  // ── Columna izquierda: config en vivo ─────────────────────────────────────────
  cfgName      = '';
  cfgImageB64: string | null = null;
  cfgRows      = 3;
  cfgCols      = 4;
  cfgPredictor  = false;
  cfgAiRewrite  = false;
  cfgIaRows     = 5;
  cfgIaCols     = 1;
  cfgUserId    = '';
  cfgSaving    = false;

  // Tableros del usuario asignado (panel izquierdo)
  userBoards:     Board[]       = [];
  userBoardsLoading = false;

  // Usuarios del centro (para cambiar userId en config)
  centerUsers:    BackendUser[] = [];

  // ── Columna derecha: modo ────────────────────────────────────────────────────
  rightMode: 'arasaac' | 'personal' | 'new' = 'arasaac';

  // ARASAAC
  arasaacQuery    = '';
  arasaacResults: ArasaacResult[] = [];
  arasaacSearching = false;
  private _arasaacDeb: ReturnType<typeof setTimeout> | null = null;

  // Pictogramas personales del usuario asignado al tablero
  personalPicts:  BackendPictogram[] = [];
  personalLoading = false;

  // Formulario de pictograma (columna derecha)
  pictForm: PictForm = this.emptyPictForm();

  // Formulario de acción
  actionForm: ActionForm = { type: 'voice', targetBoardId: '' };

  // Imagen nueva (modo 'new')
  newImgB64: string | null = null;
  newImgUrl: SafeUrl | null = null;

  // ── Constantes expuestas al template ─────────────────────────────────────────
  readonly FITZGERALD     = FITZGERALD;       // expuesto para el template
  readonly wordTypeLabels = WORD_TYPE_LABELS;
  readonly wordTypes: WordType[] = ['verb', 'pronoun', 'noun', 'descriptor', 'social', 'misc'];
  readonly actionTypes: { value: ActionType; label: string }[] = [
    { value: 'voice',          label: 'Voz'                          },
    { value: 'navigate',       label: 'Navegar a otro tablero'       },
    { value: 'voice+navigate', label: 'Voz + Navegar a otro tablero' },
    { value: 'disabled',       label: 'Desactivado'                  },
  ];

  constructor(
    private route:      ActivatedRoute,
    private router:     Router,
    private authSvc:    AuthService,
    private userSvc:    UserService,
    private boardSvc:   BoardService,
    private toastCtrl:  ToastController,
    private alertCtrl:  AlertController,
    private sanitizer:  DomSanitizer,
  ) {}

  ngOnInit() {
    this.boardId = this.route.snapshot.paramMap.get('boardId') ?? '';
    const rt = this.route.snapshot.queryParamMap.get('returnTo');
    if (rt) { this.returnTo = rt; }
  }

  ionViewWillEnter() {
    if (this.boardId) { this.loadBoard(); }
    this.loadCenterUsers();
  }

  // ── Carga ────────────────────────────────────────────────────────────────────

  private async loadBoard(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const res   = await firstValueFrom(this.boardSvc.getBoardById(this.boardId));
      this.board  = res.board;
      this.syncConfigFromBoard();
      this.loadUserBoards(this.board.userId);
      this.loadPersonalPicts(this.board.userId);
    } catch {
      this.loadError = 'Error al cargar el tablero.';
    } finally {
      this.isLoading = false;
    }
  }

  private syncConfigFromBoard(): void {
    if (!this.board) return;
    this.cfgName      = this.board.name;
    this.cfgImageB64  = this.board.imageUrl || null;
    this.cfgRows      = this.board.rows;
    this.cfgCols      = this.board.columns;
    this.cfgPredictor = this.board.predictorEnabled;
    this.cfgAiRewrite = this.board.aiRewriteEnabled;
    this.cfgIaRows    = this.board.iaRows ?? 5;
    this.cfgIaCols    = this.board.iaCols ?? 1;
    this.cfgUserId    = this.board.userId;
  }

  private async loadUserBoards(userId: string): Promise<void> {
    this.userBoardsLoading = true;
    try {
      const res        = await firstValueFrom(this.boardSvc.getBoardsByUser(userId));
      this.userBoards  = res.boards.filter((b) => b._id !== this.boardId);
    } catch { /* silencioso */ }
    finally { this.userBoardsLoading = false; }
  }

  private async loadPersonalPicts(userId: string): Promise<void> {
    this.personalLoading = true;
    try {
      const res         = await firstValueFrom(this.userSvc.getPictogramsByUserId(userId));
      this.personalPicts = res.pictograms;
    } catch { /* silencioso */ }
    finally { this.personalLoading = false; }
  }

  private async loadCenterUsers(): Promise<void> {
    const org = this.authSvc.getCurrentUser();
    if (!org?.centro) return;
    try {
      const res         = await firstValueFrom(this.userSvc.getUsersByCenter(org.centro));
      this.centerUsers  = res.users.filter((u) => u.type === 'user');
    } catch { /* silencioso */ }
  }

  // ── Grid helpers ─────────────────────────────────────────────────────────────

  /** Genera la lista de coordenadas {row, col} para el grid actual */
  get gridCells(): { row: number; col: number }[] {
    if (!this.board) return [];
    const cells: { row: number; col: number }[] = [];
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.columns; c++) {
        cells.push({ row: r, col: c });
      }
    }
    return cells;
  }

  getCellData(row: number, col: number): BoardCell | null {
    return this.board?.cells.find((c) => c.row === row && c.col === col) ?? null;
  }

  getCellPict(row: number, col: number): CellPictogram | null {
    return this.getCellData(row, col)?.pictogram ?? null;
  }

  isSelected(row: number, col: number): boolean {
    return this.selectedCell?.row === row && this.selectedCell?.col === col;
  }

  /** Color base (Fitzgerald o manual) de la celda */
  private getCellBaseColor(row: number, col: number): string | null {
    const p = this.getCellPict(row, col);
    if (!p) return null;
    return p.fitzgeraldEnabled
      ? (FITZGERALD[p.wordType as WordType] ?? '#f5f5f5')
      : (p.color || '#f5f5f5');
  }

  /** Fondo: tinte muy claro del color base (color-mix con blanco); gris si desactivado */
  getCellBgColor(row: number, col: number): string {
    if (this.getCellIsDisabled(row, col)) return '#eeeeee';
    const base = this.getCellBaseColor(row, col);
    if (!base) return '#ffffff';
    return `color-mix(in srgb, ${base} 20%, white)`;
  }

  /** Borde: versión algo más saturada del mismo color base; gris si desactivado */
  getCellBorderColor(row: number, col: number): string {
    if (this.getCellIsDisabled(row, col)) return '#bdbdbd';
    const base = this.getCellBaseColor(row, col);
    if (!base) return '#ffb6c1';           // borde rosa por defecto (celda vacía)
    return `color-mix(in srgb, ${base} 55%, white)`;
  }

  getCellIsDisabled(row: number, col: number): boolean {
    return this.getCellData(row, col)?.action?.type === 'disabled';
  }

  // ── Selección de celda ───────────────────────────────────────────────────────

  onCellClick(row: number, col: number): void {
    if (this.previewMode) {
      this.handlePreviewCellClick(row, col);
      return;
    }
    this.selectedCell = { row, col };
    const existing    = this.getCellData(row, col);
    this.isEditingCell = !!existing?.pictogram;

    if (existing?.pictogram) {
      this.loadCellIntoForm(existing);
    } else {
      this.pictForm   = this.emptyPictForm();
      this.actionForm = { type: 'voice', targetBoardId: '' };
      this.newImgB64  = null;
      this.newImgUrl  = null;
    }
  }

  private loadCellIntoForm(cell: BoardCell): void {
    const p = cell.pictogram!;
    this.pictForm = {
      source:            p.source,
      id:                p.id,
      label:             p.label,
      sound:             p.sound,
      imageUrl:          p.imageUrl,
      tags:              (p.tags ?? []).join(', '),
      description:       p.description,
      wordType:          p.wordType as WordType,
      fitzgeraldEnabled: p.fitzgeraldEnabled,
      color:             p.color,
    };
    this.actionForm = {
      type:          cell.action?.type ?? 'voice',
      targetBoardId: cell.action?.targetBoardId ?? '',
    };
    if (p.imageUrl?.startsWith('data:')) {
      this.newImgB64 = p.imageUrl;
      this.newImgUrl = this.sanitizer.bypassSecurityTrustUrl(p.imageUrl);
    } else {
      this.newImgB64 = null;
      this.newImgUrl = null;
    }
  }

  // ── Guardar/eliminar celda ────────────────────────────────────────────────────

  async saveCell(): Promise<void> {
    if (!this.selectedCell || !this.board) return;
    if (!this.pictForm.label.trim()) {
      (await this.toastCtrl.create({
        message: 'Introduce una etiqueta para el pictograma.', duration: 2200,
        color: 'warning', position: 'top',
      })).present();
      return;
    }

    const pict: CellPictogram = {
      source:            this.pictForm.source,
      id:                this.pictForm.id,
      label:             this.pictForm.label.trim(),
      imageUrl:          this.pictForm.imageUrl,
      sound:             this.pictForm.sound || this.pictForm.label.trim(),
      tags:              this.pictForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      description:       this.pictForm.description,
      wordType:          this.pictForm.wordType,
      fitzgeraldEnabled: this.pictForm.fitzgeraldEnabled,
      color:             this.pictForm.fitzgeraldEnabled
                           ? (FITZGERALD[this.pictForm.wordType] ?? '#f5f5f5')
                           : this.pictForm.color,
    };

    const action: CellAction = {
      type:          this.actionForm.type,
      targetBoardId: this.actionForm.targetBoardId || null,
    };

    // Si es pictograma nuevo, guardarlo también en pictogramas del usuario
    if (this.pictForm.source === 'new') {
      try {
        const payload: AddPictogramPayload = {
          id:          'bb-' + Date.now(),
          label:       pict.label,
          imageUrl:    pict.imageUrl,
          wordType:    pict.wordType,
          description: pict.description,
        };
        await firstValueFrom(this.userSvc.addPictogramToUser(this.board.userId, payload));
        // Refrescar lista personal
        this.loadPersonalPicts(this.board.userId);
      } catch { /* no crítico */ }
    }

    this.isSaving = true;
    try {
      const res   = await firstValueFrom(
        this.boardSvc.updateCell(this.boardId, { row: this.selectedCell.row, col: this.selectedCell.col, pictogram: pict, action })
      );
      this.board  = res.board;
      this.isEditingCell = true;
      (await this.toastCtrl.create({
        message: this.isEditingCell ? '✓ Pictograma actualizado' : '✓ Pictograma añadido',
        duration: 1800, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al guardar el pictograma.', duration: 2500,
        color: 'danger', position: 'top',
      })).present();
    } finally {
      this.isSaving = false;
    }
  }

  async removeCell(): Promise<void> {
    if (!this.selectedCell || !this.board) return;
    const alert = await this.alertCtrl.create({
      header:  'Eliminar pictograma',
      message: '¿Quieres vaciar esta celda?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            try {
              const res = await firstValueFrom(
                this.boardSvc.updateCell(this.boardId, {
                  row: this.selectedCell!.row,
                  col: this.selectedCell!.col,
                  pictogram: null,
                })
              );
              this.board         = res.board;
              this.isEditingCell = false;
              this.pictForm      = this.emptyPictForm();
            } catch {
              (await this.toastCtrl.create({
                message: 'Error al eliminar.', duration: 2000, color: 'danger', position: 'top',
              })).present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Guardar configuración (columna izquierda) ─────────────────────────────────

  async saveConfig(): Promise<void> {
    if (!this.board) return;

    // Verificar si reducir filas/cols elimina pictogramas
    const willLoseCells = this.board.cells.some(
      (c) => c.pictogram && (c.row >= this.cfgRows || c.col >= this.cfgCols)
    );

    if (willLoseCells) {
      const alert = await this.alertCtrl.create({
        header:  'Perderás pictogramas',
        message: 'Reducir el tamaño del tablero eliminará algunos pictogramas. ¿Continuar?',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Continuar', handler: () => { this.doSaveConfig(); } },
        ],
      });
      await alert.present();
    } else {
      this.doSaveConfig();
    }
  }

  private async doSaveConfig(): Promise<void> {
    if (!this.board) return;
    this.cfgSaving = true;
    try {
      // Filtrar celdas que quedan fuera del nuevo tamaño
      const remainingCells = this.board.cells.filter(
        (c) => c.row < this.cfgRows && c.col < this.cfgCols
      );
      const res = await firstValueFrom(
        this.boardSvc.updateBoard(this.boardId, {
          name:             this.cfgName,
          imageUrl:         this.cfgImageB64 ?? '',
          userId:           this.cfgUserId,
          rows:             this.cfgRows,
          columns:          this.cfgCols,
          predictorEnabled: this.cfgPredictor,
          aiRewriteEnabled: this.cfgAiRewrite,
          iaRows:           this.cfgIaRows,
          iaCols:           this.cfgIaCols,
          cells:            remainingCells,
        })
      );
      this.board = res.board;
      this.syncConfigFromBoard();
      // Si cambió el userId, recargar tableros y pictogramas del nuevo usuario
      if (this.cfgUserId !== this.board.userId) {
        this.loadUserBoards(this.board.userId);
        this.loadPersonalPicts(this.board.userId);
      }
      (await this.toastCtrl.create({
        message: '✓ Configuración guardada', duration: 1800, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al guardar la configuración.', duration: 2500, color: 'danger', position: 'top',
      })).present();
    } finally {
      this.cfgSaving = false;
    }
  }

  // ── Vista previa ──────────────────────────────────────────────────────────────

  togglePreview(): void {
    this.previewMode = !this.previewMode;
    if (this.previewMode) {
      this.aacPhrase   = [];
      this.selectedCell = null;
    }
  }

  private handlePreviewCellClick(row: number, col: number): void {
    const cell = this.getCellData(row, col);
    if (!cell?.pictogram) return;
    if (cell.action?.type === 'disabled') return;

    const type = cell.action?.type ?? 'voice';

    // Añadir a frase cuando la acción incluye voz
    if (type === 'voice' || type === 'voice+navigate') {
      this.aacPhrase.push({ ...cell.pictogram });
    }

    // Navegar cuando la acción incluye navigate: cargar el tablero destino en el mismo componente
    if (type === 'navigate' || type === 'voice+navigate') {
      const targetId = cell.action.targetBoardId;
      if (targetId) {
        this.boardId   = targetId;
        this.aacPhrase = [];   // limpiar frase al cambiar de tablero
        this.loadBoard();      // previewMode sigue siendo true
      }
    }
  }

  aacDeleteLast():  void { this.aacPhrase.pop(); }
  aacClearPhrase(): void { this.aacPhrase = []; }

  async aacSpeak() {
    (await this.toastCtrl.create({
      message: 'Síntesis de voz pendiente de implementación.', duration: 2200,
      color: 'medium', position: 'top',
    })).present();
  }

  // ── ARASAAC search ────────────────────────────────────────────────────────────

  onArasaacInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.arasaacQuery = val;
    if (this._arasaacDeb) clearTimeout(this._arasaacDeb);
    if (!val.trim() || val.length < 2) { this.arasaacResults = []; return; }
    this._arasaacDeb = setTimeout(() => this.searchArasaac(val.trim()), 400);
  }

  private async searchArasaac(q: string): Promise<void> {
    this.arasaacSearching = true;
    try {
      // Reutilizamos el endpoint backend que ya existe
      const res = await fetch(
        `http://localhost:4000/api/arasaac/search?query=${encodeURIComponent(q)}&lang=es`,
        { headers: { Authorization: `Bearer ${this.authSvc.getToken()}` } }
      );
      const data: ArasaacResult[] = await res.json();
      this.arasaacResults = Array.isArray(data) ? data.slice(0, 24) : [];
    } catch {
      this.arasaacResults = [];
    } finally {
      this.arasaacSearching = false;
    }
  }

  selectArasaacResult(r: ArasaacResult): void {
    const wordType = this.inferWordType(r.keywords);
    this.pictForm = {
      source:            'arasaac',
      id:                r.id?.toString() ?? '',
      label:             r.label,
      sound:             r.label,
      imageUrl:          r.imageUrl,
      tags:              r.keywords.join(', '),
      description:       '',
      wordType,
      fitzgeraldEnabled: true,
      color:             FITZGERALD[wordType],
    };
    this.newImgB64 = null;
    this.newImgUrl = null;
  }

  private inferWordType(keywords: string[]): WordType {
    // Inferencia básica por keywords — puede mejorarse
    const kw = keywords.join(' ').toLowerCase();
    if (/\b(yo|tú|él|ella|nosotros|ellos|vosotros|usted)\b/.test(kw)) return 'pronoun';
    if (/\b(comer|beber|dormir|jugar|ir|quiero|necesito|hacer)\b/.test(kw)) return 'verb';
    if (/\b(grande|pequeño|rojo|azul|caliente|frío|bonito|feliz)\b/.test(kw)) return 'descriptor';
    if (/\b(hola|gracias|por favor|sí|no|adiós|perdona)\b/.test(kw)) return 'social';
    return 'misc';
  }

  // ── Pictogramas personales ────────────────────────────────────────────────────

  selectPersonalPict(p: BackendPictogram): void {
    this.pictForm = {
      source:            'custom',
      id:                p.id,
      label:             p.label,
      sound:             p.label,
      imageUrl:          p.imageUrl,
      tags:              '',
      description:       p.description ?? '',
      wordType:          (p.wordType ?? 'misc') as WordType,
      fitzgeraldEnabled: true,
      color:             FITZGERALD[(p.wordType ?? 'misc') as WordType] ?? '#f5f5f5',
    };
    if (p.imageUrl?.startsWith('data:')) {
      this.newImgB64 = p.imageUrl;
      this.newImgUrl = this.sanitizer.bypassSecurityTrustUrl(p.imageUrl);
    } else {
      this.newImgB64 = null;
      this.newImgUrl = null;
    }
  }

  // ── Imagen nueva ──────────────────────────────────────────────────────────────

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
        const b64       = ev.target!.result as string;
        this.newImgB64  = b64;
        this.newImgUrl  = this.sanitizer.bypassSecurityTrustUrl(b64);
        this.pictForm.imageUrl = b64;
        this.pictForm.source   = 'new';
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // ── Imagen del tablero (config) ───────────────────────────────────────────────

  pickBoardImage(): void {
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
      reader.onload = (ev) => { this.cfgImageB64 = ev.target!.result as string; };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  removeBoardImage(): void { this.cfgImageB64 = null; }

  // ── Exportar (placeholder) ────────────────────────────────────────────────────

  async exportOBL() {
    (await this.toastCtrl.create({
      message: 'Exportación OBL pendiente de implementación.', duration: 2500,
      color: 'medium', position: 'top',
    })).present();
  }

  async importOBF() {
    (await this.toastCtrl.create({
      message: 'Importación OBF pendiente de implementación.', duration: 2500,
      color: 'medium', position: 'top',
    })).present();
  }

  async exportOBF() {
    (await this.toastCtrl.create({
      message: 'Exportación OBF pendiente de implementación.', duration: 2500,
      color: 'medium', position: 'top',
    })).present();
  }

  // ── Navegación a otro tablero del panel izquierdo ─────────────────────────────

  openBoard(boardId: string): void {
    this.router.navigate(['/board-builder-editor', boardId], {
      queryParams: { returnTo: this.returnTo },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  goBack(): void { this.router.navigateByUrl(this.returnTo); }

  buildSafeUrl(url?: string | null): SafeUrl | string {
    if (!url) return '';
    if (url.startsWith('data:')) return this.sanitizer.bypassSecurityTrustUrl(url);
    return url;
  }

  /** Color base del formulario (Fitzgerald o manual) */
  get fitzgeraldColor(): string {
    if (!this.pictForm.fitzgeraldEnabled) return this.pictForm.color || '#f5f5f5';
    return FITZGERALD[this.pictForm.wordType] ?? '#f5f5f5';
  }

  /** Fondo claro para la preview del pictograma en el formulario (mismo tinte que las celdas) */
  get fitzgeraldBgColor(): string {
    return `color-mix(in srgb, ${this.fitzgeraldColor} 20%, white)`;
  }

  /** Borde semisaturado para la preview del pictograma en el formulario */
  get fitzgeraldBorderColor(): string {
    return `color-mix(in srgb, ${this.fitzgeraldColor} 55%, white)`;
  }

  /** Muestra la columna IA cuando el predictor está activado */
  get iaColumnVisible(): boolean {
    return !!this.board?.predictorEnabled;
  }

  /** Índices para los pictogramas de la columna IA (filas × columnas) */
  get iaCells(): number[] {
    const count = (this.board?.iaRows ?? this.cfgIaRows ?? 5)
                * (this.board?.iaCols ?? this.cfgIaCols ?? 1);
    return Array.from({ length: count }, (_, i) => i);
  }

  get hasSelectedCell(): boolean { return !!this.selectedCell; }

  get previewBoardName(): string { return this.board?.name ?? ''; }

  private emptyPictForm(): PictForm {
    return {
      source: 'new', id: '', label: '', sound: '', imageUrl: '',
      tags: '', description: '', wordType: 'misc',
      fitzgeraldEnabled: true, color: '#f5f5f5',
    };
  }

  onUserSelect(event: Event): void {
    this.cfgUserId = (event as CustomEvent<{ value: string }>).detail.value ?? '';
  }

  onActionTypeSelect(event: Event): void {
    this.actionForm.type = (event as CustomEvent<{ value: ActionType }>).detail.value;
  }

  onTargetBoardSelect(event: Event): void {
    this.actionForm.targetBoardId = (event as CustomEvent<{ value: string }>).detail.value ?? '';
  }
}
