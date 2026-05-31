import { Component, OnInit } from '@angular/core';
import { NgClass } from '@angular/common';
import {
  IonicModule,
  ToastController,
  AlertController,
  ActionSheetController,
} from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import JSZip from 'jszip';
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';
import { AuthService } from '../../services/auth.service';
import { BoardService, Board } from '../../services/board.service';
import { FolderService, BoardFolder } from '../../services/folder.service';
import { ObfExportService } from '../../services/obf-export.service';
import { BoardPdfExportService } from '../../services/board-pdf-export.service';
import { ObzImportService } from '../../services/obz-import.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';

export type FilterKey =
  | 'all' | 'favorites' | 'published' | 'draft'
  | 'multi' | 'main' | 'secondary' | 'ia' | 'recent';
export type SortKey = 'recent' | 'alpha' | 'created';

export const FILTER_OPTIONS: { value: FilterKey; label: string }[] = [
  { value: 'all',       label: 'Todos' },
  { value: 'favorites', label: '★ Favoritos' },
  { value: 'published', label: 'Publicados' },
  { value: 'draft',     label: 'Borradores' },
  { value: 'main',      label: 'Principales' },
  { value: 'secondary', label: 'Secundarios' },
  { value: 'multi',     label: 'Multitablero' },
  { value: 'ia',        label: 'Con IA' },
  { value: 'recent',    label: 'Recientes' },
];

@Component({
  selector: 'app-board-builder',
  templateUrl: './board-builder.page.html',
  styleUrls: ['./board-builder.page.scss'],
  standalone: true,
  imports: [
    IonicModule, FormsModule, DragDropModule,
    NgClass,
    LoadingErrorStateComponent, AppPageHeaderComponent,
  ],
})
export class BoardBuilderPage implements OnInit {

  private returnTo = '/organization-dashboard';

  contextCreatorId   = '';
  contextCreatorName = '';

  boards:  Board[]       = [];
  folders: BoardFolder[] = [];
  isLoading = false;
  loadError = '';

  searchQuery          = '';
  selectMode           = false;
  selectedIds          = new Set<string>();
  readonly filterOptions = FILTER_OPTIONS;
  activeFilter: FilterKey = 'all';
  sortBy: SortKey         = 'recent';
  collapsedFolders        = new Set<string>();

  // Carpetas que están siendo "draggeadas encima" — para highlight
  dragOverFolderId: string | null | undefined = undefined; // undefined = ninguno

  constructor(
    private route:           ActivatedRoute,
    private router:          Router,
    private authSvc:         AuthService,
    private boardSvc:        BoardService,
    private folderSvc:       FolderService,
    private obfExportSvc:    ObfExportService,
    private boardPdfSvc:     BoardPdfExportService,
    private toastCtrl:       ToastController,
    private alertCtrl:       AlertController,
    private actionSheetCtrl: ActionSheetController,
    private sanitizer:       DomSanitizer,
    private obzImportSvc:    ObzImportService,
  ) {}

  ngOnInit() {
    const rt = this.route.snapshot.queryParamMap.get('returnTo');
    if (rt) this.returnTo = rt;
    const qId   = this.route.snapshot.queryParamMap.get('creatorId');
    const qName = this.route.snapshot.queryParamMap.get('creatorName');
    const me    = this.authSvc.getCurrentUser();
    this.contextCreatorId   = qId   || me?.id   || '';
    this.contextCreatorName = qName || me?.name || '';
  }

  ionViewWillEnter() {
    const qId   = this.route.snapshot.queryParamMap.get('creatorId');
    const qName = this.route.snapshot.queryParamMap.get('creatorName');
    const me    = this.authSvc.getCurrentUser();
    if (qId)   this.contextCreatorId   = qId;
    if (qName) this.contextCreatorName = qName;
    if (!this.contextCreatorId) {
      this.contextCreatorId   = me?.id   || '';
      this.contextCreatorName = me?.name || '';
    }
    void this.loadAll();
  }

  // ── Carga ──────────────────────────────────────────────────────────────────

  private async loadAll(): Promise<void> {
    if (!this.contextCreatorId) {
      this.loadError = 'No se pudo determinar el creador del builder.';
      return;
    }
    this.isLoading = true;
    this.loadError = '';
    try {
      const [boardsRes, foldersRes] = await Promise.all([
        firstValueFrom(this.boardSvc.getBoardsByCreator(this.contextCreatorId)),
        firstValueFrom(this.folderSvc.getFolders()),
      ]);
      this.boards  = boardsRes.boards;
      this.folders = foldersRes.folders;
    } catch {
      this.loadError = 'Error al cargar los tableros.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Filtro / orden ─────────────────────────────────────────────────────────

  setFilter(f: FilterKey): void { this.activeFilter = f; }

  get filteredBoards(): Board[] {
    const q    = this.searchQuery.trim().toLowerCase();
    const now  = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;

    let result = this.boards;
    if (q) result = result.filter(b => b.name.toLowerCase().includes(q));

    switch (this.activeFilter) {
      case 'favorites': result = result.filter(b => b.isFavorite); break;
      case 'published': result = result.filter(b => b.visibleInProfile); break;
      case 'draft':     result = result.filter(b => !b.visibleInProfile); break;
      case 'main':      result = result.filter(b => !b.boardRole || b.boardRole === 'main'); break;
      case 'secondary': result = result.filter(b => b.boardRole === 'secondary'); break;
      case 'multi':     result = result.filter(b => b.boardRole === 'multi'); break;
      case 'ia':        result = result.filter(b => !!b.predictorEnabled); break;
      case 'recent':    result = result.filter(b =>
        !!b.createdAt && now - new Date(b.createdAt).getTime() < week); break;
    }

    return [...result].sort((a, b) => {
      if (this.sortBy === 'alpha')   return a.name.localeCompare(b.name, 'es');
      return this.dateCmp(a.createdAt, b.createdAt);
    });
  }

  private dateCmp(a?: string, b?: string): number {
    return new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime();
  }

  get totalFiltered(): number { return this.filteredBoards.length; }

  getBoardsInFolder(folderId: string): Board[] {
    return this.filteredBoards.filter(b => b.folderId === folderId);
  }

  get unfolderedBoards(): Board[] {
    return this.filteredBoards.filter(b => !b.folderId);
  }

  get visibleFolders(): BoardFolder[] {
    if (this.activeFilter === 'all' && !this.searchQuery) return this.folders;
    return this.folders.filter(f => this.getBoardsInFolder(f._id).length > 0);
  }

  // ── Colapso de carpetas ────────────────────────────────────────────────────

  toggleFolderCollapse(folderId: string): void {
    if (this.collapsedFolders.has(folderId)) {
      this.collapsedFolders.delete(folderId);
    } else {
      this.collapsedFolders.add(folderId);
    }
    this.collapsedFolders = new Set(this.collapsedFolders);
  }

  isFolderCollapsed(folderId: string): boolean {
    return this.collapsedFolders.has(folderId);
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────────

  // Registra cuándo terminó el último drag para ignorar el click que el
  // browser dispara justo después de soltar. cdkDragEnded se emite DESPUÉS
  // del drop, cuando CDK ya terminó — no dispara CD durante el arrastre.
  private lastDragEndMs = 0;

  onDragStarted(): void {
    console.log('[DnD] ▶ cdkDragStarted');
  }

  onDragEnded(): void {
    console.log('[DnD] ■ cdkDragEnded — drag finalizado');
    this.lastDragEndMs = Date.now();
  }

  onCardClick(boardId: string): void {
    if (Date.now() - this.lastDragEndMs < 300) return;
    if (this.selectMode) {
      this.toggleSelect(boardId);
    } else {
      this.openEditor(boardId);
    }
  }

  onBoardDropped(event: CdkDragDrop<string | null>): void {
    const board: Board   = event.item.data;
    const targetFolderId = event.container.data ?? null;
    const sourceFolderId = board.folderId ?? null;

    console.log('[DnD] ✓ cdkDropListDropped', {
      previousContainer: event.previousContainer.id,
      container:         event.container.id,
      previousIndex:     event.previousIndex,
      currentIndex:      event.currentIndex,
      board:             board?.name,
      from:              sourceFolderId ?? 'sin-carpeta',
      to:                targetFolderId ?? 'sin-carpeta',
    });

    this.dragOverFolderId = undefined;

    if (targetFolderId === sourceFolderId) {
      console.log('[DnD] mismo destino — nada que hacer');
      return;
    }

    // Expandir la carpeta destino solo DESPUÉS del drop (CDK ya terminó)
    if (targetFolderId && this.collapsedFolders.has(targetFolderId)) {
      this.collapsedFolders.delete(targetFolderId);
      this.collapsedFolders = new Set(this.collapsedFolders);
    }

    void this.doMoveBoard(board, targetFolderId);
  }

  onDragEnterFolder(folderId: string | null): void {
    console.log('[DnD] entered drop list:', folderId ?? 'sin-carpeta');
    this.dragOverFolderId = folderId;
    // NO se expanden carpetas colapsadas durante el drag.
    // Expandir una carpeta crea un nuevo cdkDropList mientras CDK tiene una drag
    // activa — esto corrompe el estado interno de CDK y deja el preview flotando.
  }

  onDragExitFolder(): void {
    console.log('[DnD] exited drop list');
    this.dragOverFolderId = undefined;
  }

  // ── CRUD carpetas ──────────────────────────────────────────────────────────

  async createFolder(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Nueva carpeta',
      inputs: [{ name: 'name', type: 'text', placeholder: 'Nombre de la carpeta' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Crear',
          handler: async (data) => {
            const name = data.name?.trim();
            if (!name) return;
            try {
              const res = await firstValueFrom(this.folderSvc.createFolder(name));
              this.folders = [...this.folders, res.folder];
              (await this.toastCtrl.create({
                message: `✓ Carpeta "${name}" creada`, duration: 1800,
                color: 'success', position: 'top',
              })).present();
            } catch {
              this.showError('Error al crear la carpeta');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async renameFolder(folder: BoardFolder, event: Event): Promise<void> {
    event.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Renombrar carpeta',
      inputs: [{ name: 'name', type: 'text', value: folder.name, placeholder: 'Nuevo nombre' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: async (data) => {
            const name = data.name?.trim();
            if (!name || name === folder.name) return;
            try {
              const res = await firstValueFrom(this.folderSvc.renameFolder(folder._id, name));
              this.folders = this.folders.map(f => f._id === folder._id ? res.folder : f);
            } catch {
              this.showError('Error al renombrar');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async deleteFolder(folder: BoardFolder, event: Event): Promise<void> {
    event.stopPropagation();
    const count = this.boards.filter(b => b.folderId === folder._id).length;
    const alert = await this.alertCtrl.create({
      header: '¿Eliminar carpeta?',
      message: `"${folder.name}" se eliminará.${count > 0
        ? ` Los ${count} tablero${count !== 1 ? 's' : ''} quedarán sin carpeta.` : ''}`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar', role: 'destructive',
          handler: async () => {
            try {
              await firstValueFrom(this.folderSvc.deleteFolder(folder._id));
              this.folders = this.folders.filter(f => f._id !== folder._id);
              this.boards  = this.boards.map(b =>
                b.folderId === folder._id ? { ...b, folderId: null } : b);
            } catch {
              this.showError('Error al eliminar la carpeta');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Mover tablero (individual) ─────────────────────────────────────────────

  async moveBoardToFolder(board: Board, event: Event): Promise<void> {
    event.stopPropagation();
    const buttons: any[] = this.folders.map(f => ({
      text: f.name,
      icon: board.folderId === f._id ? 'checkmark' : 'folder-outline',
      handler: () => { void this.doMoveBoard(board, f._id); },
    }));
    buttons.push({
      text: 'Sin carpeta',
      icon: board.folderId ? 'remove-circle-outline' : 'checkmark',
      handler: () => { void this.doMoveBoard(board, null); },
    });
    buttons.push({ text: 'Cancelar', role: 'cancel' });

    (await this.actionSheetCtrl.create({
      header: `Mover "${board.name}"`,
      buttons,
    })).present();
  }

  async doMoveBoard(board: Board, folderId: string | null): Promise<void> {
    try {
      await firstValueFrom(this.boardSvc.assignFolder(board._id, folderId));
      this.boards = this.boards.map(b =>
        b._id === board._id ? { ...b, folderId: folderId ?? null } : b);
    } catch {
      this.showError('Error al mover el tablero');
    }
  }

  // ── Mover selección múltiple a carpeta ─────────────────────────────────────

  async moveSelectedToFolder(): Promise<void> {
    if (this.selectedIds.size === 0) return;
    const n = this.selectedIds.size;

    const buttons: any[] = this.folders.map(f => ({
      text: f.name,
      icon: 'folder-outline',
      handler: () => { void this.bulkMoveToFolder(f._id); },
    }));
    buttons.push({
      text: 'Sin carpeta',
      icon: 'remove-circle-outline',
      handler: () => { void this.bulkMoveToFolder(null); },
    });
    buttons.push({ text: 'Cancelar', role: 'cancel' });

    (await this.actionSheetCtrl.create({
      header: `Mover ${n} tablero${n !== 1 ? 's' : ''}`,
      buttons,
    })).present();
  }

  private async bulkMoveToFolder(folderId: string | null): Promise<void> {
    const ids = [...this.selectedIds];
    try {
      await Promise.all(ids.map(id => firstValueFrom(this.boardSvc.assignFolder(id, folderId))));
      this.boards = this.boards.map(b =>
        ids.includes(b._id) ? { ...b, folderId: folderId ?? null } : b);
      this.selectedIds.clear();
      this.selectMode = false;
      (await this.toastCtrl.create({
        message: `✓ ${ids.length} tablero${ids.length !== 1 ? 's' : ''} movido${ids.length !== 1 ? 's' : ''}`,
        duration: 2000, color: 'success', position: 'top',
      })).present();
    } catch {
      this.showError('Error al mover los tableros');
    }
  }

  // ── Favoritos ──────────────────────────────────────────────────────────────

  async toggleFavorite(board: Board, event: Event): Promise<void> {
    event.stopPropagation();
    const newValue = !board.isFavorite;
    // Actualización optimista
    this.boards = this.boards.map(b =>
      b._id === board._id ? { ...b, isFavorite: newValue } : b);
    try {
      await firstValueFrom(this.boardSvc.toggleFavorite(board._id, newValue));
    } catch {
      // Revertir si falla
      this.boards = this.boards.map(b =>
        b._id === board._id ? { ...b, isFavorite: !newValue } : b);
      this.showError('Error al actualizar favorito');
    }
  }

  // ── Descarga por tarjeta ───────────────────────────────────────────────────

  async downloadBoard(board: Board, event: Event): Promise<void> {
    event.stopPropagation();
    (await this.actionSheetCtrl.create({
      header: board.name,
      buttons: [
        {
          text: 'Descargar OBF / OBZ',
          icon: 'archive-outline',
          handler: () => { void this.exportBoardOBZ(board); },
        },
        {
          text: 'Descargar PDF',
          icon: 'document-text-outline',
          handler: () => { void this.exportBoardPdf(board); },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    })).present();
  }

  private async exportBoardOBZ(board: Board): Promise<void> {
    this.isLoading = true;
    try {
      const { board: full } = await firstValueFrom(this.boardSvc.getBoardById(board._id));
      const { boards, warnings } = await this.obfExportSvc.collectLinkedBoards(full);
      const { blob, boardCount }  = await this.obfExportSvc.buildOBZPackage(full, boards);
      const safeName = this.obfExportSvc.makeSafeName(full.name);
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = `${safeName}.obz`; a.click();
      URL.revokeObjectURL(url);
      (await this.toastCtrl.create({
        message: `✓ ${safeName}.obz · ${boardCount} tablero(s)`
          + (warnings.length ? ` · ${warnings.length} aviso(s)` : ''),
        duration: 2800, color: 'success', position: 'top',
      })).present();
    } catch {
      this.showError('Error al generar el paquete OBZ');
    } finally {
      this.isLoading = false;
    }
  }

  private async exportBoardPdf(board: Board): Promise<void> {
    this.isLoading = true;
    try {
      const { board: full } = await firstValueFrom(this.boardSvc.getBoardById(board._id));
      await this.boardPdfSvc.exportToPdf(full);
      (await this.toastCtrl.create({
        message: `✓ PDF generado: ${board.name}`,
        duration: 2200, color: 'success', position: 'top',
      })).present();
    } catch {
      this.showError('Error al generar el PDF');
    } finally {
      this.isLoading = false;
    }
  }

  // ── Selección múltiple ─────────────────────────────────────────────────────

  toggleSelectMode(): void {
    this.selectMode = !this.selectMode;
    if (!this.selectMode) this.selectedIds.clear();
  }

  toggleSelect(boardId: string, event?: Event): void {
    event?.stopPropagation();
    if (this.selectedIds.has(boardId)) {
      this.selectedIds.delete(boardId);
    } else {
      this.selectedIds.add(boardId);
    }
    this.selectedIds = new Set(this.selectedIds);
  }

  isSelected(boardId: string): boolean { return this.selectedIds.has(boardId); }
  get selectedCount(): number { return this.selectedIds.size; }

  async deleteSelected(): Promise<void> {
    const count = this.selectedIds.size;
    if (count === 0) return;
    const alert = await this.alertCtrl.create({
      header:  '¿Eliminar tableros?',
      message: `Se eliminarán ${count} tablero${count > 1 ? 's' : ''} de forma permanente.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar', role: 'destructive',
          handler: async () => {
            const ids = [...this.selectedIds];
            this.isLoading = true;
            try {
              const results = await Promise.allSettled(
                ids.map(id => firstValueFrom(this.boardSvc.deleteBoard(id))));
              const ok   = results.filter(r => r.status === 'fulfilled').length;
              const fail = results.filter(r => r.status === 'rejected').length;
              this.boards = this.boards.filter(b => !ids.includes(b._id));
              this.selectedIds.clear();
              this.selectMode = false;
              (await this.toastCtrl.create({
                message: fail === 0
                  ? `${ok} tablero${ok !== 1 ? 's' : ''} eliminado${ok !== 1 ? 's' : ''}`
                  : `${ok} de ${count} eliminados (${fail} con error)`,
                duration: 2500,
                color: fail === 0 ? 'success' : 'warning', position: 'top',
              })).present();
            } finally {
              this.isLoading = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Navegación ─────────────────────────────────────────────────────────────

  goBack()     { this.router.navigateByUrl(this.returnTo); }

  goToCreate() {
    this.router.navigate(['/board-builder-create'], {
      queryParams: {
        returnTo:    '/board-builder',
        creatorId:   this.contextCreatorId,
        creatorName: this.contextCreatorName,
      },
    });
  }

  openEditor(boardId: string) {
    this.router.navigate(['/board-builder-editor', boardId], {
      queryParams: {
        returnTo:    '/board-builder',
        creatorId:   this.contextCreatorId,
        creatorName: this.contextCreatorName,
      },
    });
  }

  // ── Importación OBZ ────────────────────────────────────────────────────────

  async importOBZ(): Promise<void> {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.obz,.zip,application/zip,application/octet-stream';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const me = this.authSvc.getCurrentUser();
      if (!me?.id) {
        this.showError('No hay sesión activa');
        return;
      }
      let zip: JSZip;
      try { zip = await JSZip.loadAsync(file); }
      catch {
        this.showError('Error al leer el archivo OBZ');
        return;
      }
      this.isLoading = true;
      try {
        const result = await this.obzImportSvc.importOBZ(zip, {
          userId:           this.contextCreatorId || me.id,
          contextCreatorId: this.contextCreatorId || undefined,
        });
        await this.loadAll();
        (await this.toastCtrl.create({
          message: `✓ OBZ importado · ${result.entries.length} tablero(s)`,
          duration: 3000, color: 'success', position: 'top',
        })).present();
        if (result.warnings.length > 0) {
          (await this.alertCtrl.create({
            header:  'Avisos de importación OBZ',
            message: result.warnings.map(w => `• ${w}`).join('\n'),
            buttons: [
              { text: 'Cerrar', role: 'cancel' },
              ...(result.rootMongoId
                ? [{ text: 'Abrir tablero raíz', handler: () => this.openEditor(result.rootMongoId!) }]
                : []),
            ],
          })).present();
        } else if (result.rootMongoId) {
          this.openEditor(result.rootMongoId);
        }
      } catch {
        this.showError('Error durante la importación OBZ');
      } finally {
        this.isLoading = false;
      }
    };
    input.click();
  }

  // ── Duplicar / Eliminar ────────────────────────────────────────────────────

  async duplicateBoard(board: Board, event: Event): Promise<void> {
    event.stopPropagation();
    this.isLoading = true;
    try {
      const res = await firstValueFrom(this.boardSvc.duplicateBoard(board._id));
      const idx = this.boards.findIndex(b => b._id === board._id);
      this.boards = idx >= 0
        ? [...this.boards.slice(0, idx + 1), res.board, ...this.boards.slice(idx + 1)]
        : [res.board, ...this.boards];
      (await this.toastCtrl.create({
        message: `✓ "${res.board.name}" creado`, duration: 2000,
        color: 'success', position: 'top',
      })).present();
    } catch {
      this.showError('No se pudo duplicar el tablero');
    } finally {
      this.isLoading = false;
    }
  }

  async deleteBoard(board: Board, event: Event): Promise<void> {
    event.stopPropagation();
    const alert = await this.alertCtrl.create({
      header:  '¿Eliminar tablero?',
      message: `Se eliminará "${board.name}" de forma permanente.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar', role: 'destructive',
          handler: async () => {
            try {
              await firstValueFrom(this.boardSvc.deleteBoard(board._id));
              this.boards = this.boards.filter(b => b._id !== board._id);
              this.selectedIds.delete(board._id);
              (await this.toastCtrl.create({
                message: 'Tablero eliminado', duration: 1800,
                color: 'success', position: 'top',
              })).present();
            } catch {
              this.showError('Error al eliminar');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  boardBadges(board: Board): Array<{ label: string; cls: string }> {
    const b: Array<{ label: string; cls: string }> = [];
    if (board.boardRole === 'multi')     b.push({ label: 'MULTI',      cls: 'bb-badge--multi' });
    if (board.boardRole === 'secondary') b.push({ label: 'SECUNDARIO', cls: 'bb-badge--sec'   });
    if (!board.boardRole || board.boardRole === 'main')
                                         b.push({ label: 'PRINCIPAL',  cls: 'bb-badge--main'  });
    if (board.visibleInProfile)          b.push({ label: 'PUBLICADO',  cls: 'bb-badge--pub'   });
    if (board.predictorEnabled)          b.push({ label: 'IA',         cls: 'bb-badge--ia'    });
    return b;
  }

  shapeLabel(shape: string): string {
    return shape === 'circular' ? 'Circular' : shape === 'multi' ? 'Multi' : 'Cuadrícula';
  }

  dimensionLabel(b: Board): string {
    if (b.shape === 'circular') return `${b.circleSlots} pos.`;
    if (b.boardRole === 'multi' || b.shape === 'multi') return `${b.slotCount ?? 2} huecos`;
    return `${b.rows}×${b.columns}`;
  }

  formatDate(iso?: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  buildSafeUrl(url?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(url, this.sanitizer);
  }

  private async showError(msg: string): Promise<void> {
    (await this.toastCtrl.create({
      message: msg, duration: 2200, color: 'danger', position: 'top',
    })).present();
  }
}
