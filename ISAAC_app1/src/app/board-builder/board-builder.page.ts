import { Component, OnInit } from '@angular/core';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { BoardService, Board } from '../services/board.service';

@Component({
  selector: 'app-board-builder',
  templateUrl: './board-builder.page.html',
  styleUrls: ['./board-builder.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class BoardBuilderPage implements OnInit {

  /** Ruta a la que volver — la impone el caller vía ?returnTo= */
  private returnTo = '/organization-dashboard';

  boards: Board[] = [];
  isLoading = false;
  loadError = '';

  constructor(
    private route:       ActivatedRoute,
    private router:      Router,
    private boardSvc:    BoardService,
    private toastCtrl:   ToastController,
    private alertCtrl:   AlertController,
    private sanitizer:   DomSanitizer,
  ) {}

  ngOnInit() {
    const rt = this.route.snapshot.queryParamMap.get('returnTo');
    if (rt) { this.returnTo = rt; }
  }

  ionViewWillEnter() {
    this.loadBoards();
  }

  // ── Carga ────────────────────────────────────────────────────────────────────

  private async loadBoards(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(this.boardSvc.getMyBoards());
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
      queryParams: { returnTo: '/board-builder' },
    });
  }

  openEditor(boardId: string) {
    this.router.navigate(['/board-builder-editor', boardId], {
      queryParams: { returnTo: '/board-builder' },
    });
  }

  // ── Acciones placeholder ──────────────────────────────────────────────────────

  async importOBL() {
    const t = await this.toastCtrl.create({
      message:  'Importación OBF / OBL pendiente de implementación',
      duration: 2500,
      color:    'medium',
      position: 'top',
    });
    await t.present();
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
    if (!url) return '';
    if (url.startsWith('data:')) return this.sanitizer.bypassSecurityTrustUrl(url);
    return url;
  }
}
