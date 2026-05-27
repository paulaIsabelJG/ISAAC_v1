import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { AacRuntimeService, AacPhraseItem } from '../services/aac-runtime.service';
import { BoardService, Board, BoardCell, CellPictogram } from '../services/board.service';
import { UserService, FullBackendUser } from '../services/user.service';
import { BoardLayoutService } from '../services/board-layout.service';
import { buildSafeUrl as buildSafeUrlUtil } from '../shared/utils/image.utils';

@Component({
  selector: 'app-communicator',
  templateUrl: './communicator.page.html',
  styleUrls:  ['./communicator.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule],
})
export class CommunicatorPage implements OnInit, OnDestroy {
  userId     = '';
  returnTo   = '/';
  targetUser: FullBackendUser | null = null;

  board:       Board | null = null;
  isLoading    = true;
  loadError    = '';

  phrase: AacPhraseItem[] = [];

  private navSub?:    Subscription;
  private phraseSub?: Subscription;

  constructor(
    private route:          ActivatedRoute,
    private router:         Router,
    private aac:            AacRuntimeService,
    private boardSvc:       BoardService,
    private userSvc:        UserService,
    private sanitizer:      DomSanitizer,
    private boardLayoutSvc: BoardLayoutService,
  ) {}

  ngOnInit() {
    this.userId   = this.route.snapshot.queryParamMap.get('userId') ?? '';
    this.returnTo = this.route.snapshot.queryParamMap.get('returnTo') ?? '/user-session/' + this.userId;
  }

  async ionViewWillEnter() {
    const boardId = this.route.snapshot.paramMap.get('boardId') ?? '';

    // Load user profile (for voice gender)
    if (this.userId) {
      try {
        const res = await firstValueFrom(this.userSvc.getUserById(this.userId));
        this.targetUser = res.user;
      } catch { /* silencioso */ }
    }

    // Start AAC session
    await this.aac.startSession(this.userId, boardId, 'communicator');
    console.log('[Communicator] mode=communicator userId:', this.userId, 'boardId:', boardId);

    // Subscribe to board navigation events
    this.navSub = this.aac.boardNavigated$.subscribe((newBoardId) => {
      void this.loadBoard(newBoardId);
    });

    // Subscribe to phrase changes
    this.phraseSub = this.aac.phraseChanged$.subscribe((p) => {
      this.phrase = p;
    });

    await this.loadBoard(boardId);
  }

  async ionViewWillLeave() {
    await this.aac.endSession();
    this.navSub?.unsubscribe();
    this.phraseSub?.unsubscribe();
  }

  ngOnDestroy() {
    this.navSub?.unsubscribe();
    this.phraseSub?.unsubscribe();
  }

  // ── Board loading ─────────────────────────────────────────────────────────

  async loadBoard(boardId: string): Promise<void> {
    if (!boardId) return;
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(this.boardSvc.getBoardById(boardId));
      this.board = res.board;
    } catch {
      this.loadError = 'No se pudo cargar el tablero.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Grid helpers (delegados a BoardLayoutService) ────────────────────────────

  get gridCells(): { row: number; col: number }[] {
    return this.boardLayoutSvc.gridCells(this.board);
  }

  getCellData(row: number, col: number): BoardCell | null {
    return this.boardLayoutSvc.getCellData(this.board, row, col);
  }

  getCellPict(row: number, col: number): CellPictogram | null {
    return this.boardLayoutSvc.getCellPict(this.board, row, col);
  }

  buildImageUrl(url?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(url, this.sanitizer);
  }

  // ── Cell press ────────────────────────────────────────────────────────────

  onCellPress(row: number, col: number): void {
    const cell = this.getCellData(row, col);
    if (!cell?.pictogram) return;
    this.aac.handlePictogramPress(cell, this.board!._id);
  }

  // ── Header controls ───────────────────────────────────────────────────────

  onSpeak(): void {
    this.aac.speakPhrase(this.targetUser?.gender ?? undefined);
  }

  onDeleteLast(): void {
    this.aac.deleteLast();
  }

  onClearPhrase(): void {
    this.aac.clearPhrase();
  }

  onHome(): void {
    this.aac.goHome();
  }

  onBack(): void {
    if (this.aac.boardStack.length > 0) {
      this.aac.goBack();
    } else {
      this.router.navigateByUrl(this.returnTo);
    }
  }

  get canGoBack(): boolean {
    return this.aac.boardStack.length > 0;
  }
}
