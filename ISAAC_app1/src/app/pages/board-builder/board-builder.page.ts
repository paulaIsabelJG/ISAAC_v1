import { Component, OnInit } from '@angular/core';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import JSZip from 'jszip';
import { AuthService } from '../../services/auth.service';
import { BoardService, Board } from '../../services/board.service';
import { ObzImportService } from '../../services/obz-import.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';

@Component({
  selector: 'app-board-builder',
  templateUrl: './board-builder.page.html',
  styleUrls: ['./board-builder.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, LoadingErrorStateComponent, AppPageHeaderComponent],
})
export class BoardBuilderPage implements OnInit {

  /** Ruta a la que volver — la impone el caller vía ?returnTo= */
  private returnTo = '/organization-dashboard';

  /** Contexto del builder: de quién son los tableros que se muestran.
   *  Si no se pasa creatorId en query params, se usa el usuario de sesión. */
  contextCreatorId   = '';
  contextCreatorName = '';

  boards: Board[] = [];
  isLoading = false;
  loadError = '';

  // ── Búsqueda y selección ─────────────────────────────────────────────────────
  searchQuery = '';
  selectMode  = false;
  selectedIds = new Set<string>();

  constructor(
    private route:          ActivatedRoute,
    private router:         Router,
    private authSvc:        AuthService,
    private boardSvc:       BoardService,
    private toastCtrl:      ToastController,
    private alertCtrl:      AlertController,
    private sanitizer:      DomSanitizer,
    private obzImportSvc:   ObzImportService,
  ) {}

  ngOnInit() {
    const rt = this.route.snapshot.queryParamMap.get('returnTo');
    if (rt) { this.returnTo = rt; }

    // Contexto del builder: ¿de quién son los tableros que vamos a mostrar?
    const qCreatorId   = this.route.snapshot.queryParamMap.get('creatorId');
    const qCreatorName = this.route.snapshot.queryParamMap.get('creatorName');

    const me = this.authSvc.getCurrentUser();

    // Si viene creatorId por param, ese es el contexto; si no, yo mismo soy el contexto.
    this.contextCreatorId   = qCreatorId   || me?.id   || '';
    this.contextCreatorName = qCreatorName || me?.name || '';
  }

  ionViewWillEnter() {
    // Refrescar contexto del route snapshot (cubre el caso en que Ionic reutiliza
    // la instancia y el dashboard abre un builder con un creatorId diferente)
    const qCreatorId   = this.route.snapshot.queryParamMap.get('creatorId');
    const qCreatorName = this.route.snapshot.queryParamMap.get('creatorName');
    const me           = this.authSvc.getCurrentUser();
    if (qCreatorId)   { this.contextCreatorId   = qCreatorId; }
    if (qCreatorName) { this.contextCreatorName = qCreatorName; }
    if (!this.contextCreatorId) {
      this.contextCreatorId   = me?.id   || '';
      this.contextCreatorName = me?.name || '';
    }
    this.loadBoards();
  }

  // ── Carga ────────────────────────────────────────────────────────────────────

  private async loadBoards(): Promise<void> {
    if (!this.contextCreatorId) {
      this.loadError = 'No se pudo determinar el creador del builder.';
      return;
    }
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(
        this.boardSvc.getBoardsByCreator(this.contextCreatorId)
      );
      this.boards = res.boards;
    } catch {
      this.loadError = 'Error al cargar los tableros.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Navegación ────────────────────────────────────────────────────────────────

  goBack() { this.router.navigateByUrl(this.returnTo); }

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

  // ── Búsqueda y secciones ─────────────────────────────────────────────────────

  get filteredBoards(): Board[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.boards;
    return this.boards.filter((b) => b.name.toLowerCase().includes(q));
  }

  get mainBoards(): Board[] {
    return this.filteredBoards.filter(
      (b) => !b.boardRole || b.boardRole === 'main',
    );
  }

  get secondaryBoards(): Board[] {
    return this.filteredBoards.filter((b) => b.boardRole === 'secondary');
  }

  // ── Selección múltiple ────────────────────────────────────────────────────────

  toggleSelectMode(): void {
    this.selectMode = !this.selectMode;
    if (!this.selectMode) { this.selectedIds.clear(); }
  }

  toggleSelect(boardId: string, event?: Event): void {
    event?.stopPropagation();
    if (this.selectedIds.has(boardId)) {
      this.selectedIds.delete(boardId);
    } else {
      this.selectedIds.add(boardId);
    }
    this.selectedIds = new Set(this.selectedIds); // trigger change detection
  }

  isSelected(boardId: string): boolean {
    return this.selectedIds.has(boardId);
  }

  get selectedCount(): number { return this.selectedIds.size; }

  async deleteSelected(): Promise<void> {
    const count = this.selectedIds.size;
    if (count === 0) return;

    const alert = await this.alertCtrl.create({
      header:  '¿Eliminar tableros?',
      message: `Se eliminarán ${count} tablero${count > 1 ? 's' : ''} de forma permanente. Esta acción no se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            const ids = [...this.selectedIds];
            this.isLoading = true;
            try {
              const results = await Promise.allSettled(
                ids.map((id) => firstValueFrom(this.boardSvc.deleteBoard(id))),
              );
              const ok    = results.filter((r) => r.status === 'fulfilled').length;
              const fail  = results.filter((r) => r.status === 'rejected').length;
              this.boards = this.boards.filter((b) => !ids.includes(b._id));
              this.selectedIds.clear();
              this.selectMode = false;
              const msg = fail === 0
                ? `${ok} tablero${ok !== 1 ? 's' : ''} eliminado${ok !== 1 ? 's' : ''}`
                : `Se eliminaron ${ok} de ${count} tableros (${fail} con error)`;
              (await this.toastCtrl.create({
                message: msg, duration: 2500,
                color: fail === 0 ? 'success' : 'warning',
                position: 'top',
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

  // ── Importación OBZ ───────────────────────────────────────────────────────────

  /**
   * Abre selector de archivo .obz y delega la importación completa al servicio.
   * El componente solo gestiona el estado de carga, los toasts y la navegación post-import.
   */
  async importOBZ(): Promise<void> {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.obz,.zip,application/zip,application/octet-stream';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const currentUser = this.authSvc.getCurrentUser();
      if (!currentUser?.id) {
        (await this.toastCtrl.create({
          message:  'No hay sesión activa. Inicia sesión e inténtalo de nuevo.',
          duration: 3000, color: 'danger', position: 'top',
        })).present();
        return;
      }

      let zip: JSZip;
      try { zip = await JSZip.loadAsync(file); }
      catch {
        (await this.toastCtrl.create({
          message:  'Error al leer el archivo OBZ. ¿Es un ZIP válido?',
          duration: 3000, color: 'danger', position: 'top',
        })).present();
        return;
      }

      this.isLoading = true;
      try {
        const result = await this.obzImportSvc.importOBZ(zip, {
          userId:           this.contextCreatorId || currentUser.id,
          contextCreatorId: this.contextCreatorId || undefined,
        });

        await this.loadBoards();

        (await this.toastCtrl.create({
          message: `✓ OBZ importado correctamente · ${result.entries.length} tablero(s)`
            + (result.warnings.length ? ` · ${result.warnings.length} aviso(s)` : ''),
          duration: 3000, color: 'success', position: 'top',
        })).present();

        if (result.warnings.length > 0) {
          const alert = await this.alertCtrl.create({
            header:  'Avisos de importación OBZ',
            message: result.warnings.map(w => `• ${w}`).join('\n'),
            buttons: [
              { text: 'Cerrar', role: 'cancel' },
              ...(result.rootMongoId ? [{
                text:    'Abrir tablero raíz',
                handler: () => { this.openEditor(result.rootMongoId!); },
              }] : []),
            ],
          });
          await alert.present();
        } else if (result.rootMongoId) {
          this.openEditor(result.rootMongoId);
        }
      } catch (err) {
        console.error('importOBZ error:', err);
        (await this.toastCtrl.create({
          message:  'Error durante la importación OBZ.',
          duration: 3000, color: 'danger', position: 'top',
        })).present();
      } finally {
        this.isLoading = false;
      }
    };
    input.click();
  }

  async duplicateBoard(board: Board, event: Event): Promise<void> {
    event.stopPropagation();
    this.isLoading = true;
    try {
      const res = await firstValueFrom(this.boardSvc.duplicateBoard(board._id));
      // Insertar la copia justo después del tablero original en la lista local
      const idx = this.boards.findIndex((b) => b._id === board._id);
      if (idx >= 0) {
        this.boards = [
          ...this.boards.slice(0, idx + 1),
          res.board,
          ...this.boards.slice(idx + 1),
        ];
      } else {
        this.boards = [res.board, ...this.boards];
      }
      (await this.toastCtrl.create({
        message:  `✓ "${res.board.name}" creado`,
        duration: 2000,
        color:    'success',
        position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message:  'No se pudo duplicar el tablero',
        duration: 2500,
        color:    'danger',
        position: 'top',
      })).present();
    } finally {
      this.isLoading = false;
    }
  }

  async deleteBoard(board: Board, event: Event) {
    event.stopPropagation();
    const alert = await this.alertCtrl.create({
      header:  '¿Eliminar tablero?',
      message: `Se eliminará "${board.name}" de forma permanente.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            try {
              await firstValueFrom(this.boardSvc.deleteBoard(board._id));
              this.boards = this.boards.filter((b) => b._id !== board._id);
              this.selectedIds.delete(board._id);
              (await this.toastCtrl.create({
                message: 'Tablero eliminado', duration: 1800,
                color: 'success', position: 'top',
              })).present();
            } catch {
              (await this.toastCtrl.create({
                message: 'Error al eliminar el tablero', duration: 2500,
                color: 'danger', position: 'top',
              })).present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  shapeLabel(shape: string): string {
    return shape === 'circular' ? 'Circular' : 'Cuadrícula';
  }

  dimensionLabel(b: Board): string {
    if (b.shape === 'grid') return `${b.rows} × ${b.columns}`;
    return `${b.circleSlots} posiciones`;
  }

  formatDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  buildSafeUrl(url?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(url, this.sanitizer);
  }
}
