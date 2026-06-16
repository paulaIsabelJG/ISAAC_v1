import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { IonicModule, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ObjectiveCommentsService } from '../../services/objective-comments.service';
import { ObjectiveComment } from '../../models/objective-comment.model';
import { ObjectiveCommentItemComponent } from '../objective-comment-item/objective-comment-item.component';

@Component({
  selector: 'app-objective-comments',
  templateUrl: './objective-comments.component.html',
  styleUrls:   ['./objective-comments.component.scss'],
  standalone:   true,
  imports: [IonicModule, CommonModule, FormsModule, ObjectiveCommentItemComponent],
})
export class ObjectiveCommentsComponent implements OnInit, OnChanges {

  @Input() objectiveId!:   string;
  /** ID del usuario final al que pertenece este hilo de comentarios */
  @Input() targetUserId!:  string;
  @Input() canComment      = true;

  @Output() commentsCountChanged = new EventEmitter<number>();

  comments:   ObjectiveComment[] = [];
  isLoading   = true;
  loadError   = '';

  newText     = '';
  isSaving    = false;
  saveError   = '';

  editingId:  string | null = null;
  editText    = '';
  isUpdating  = false;

  currentUserId = '';
  isOrgAdmin    = false;

  constructor(
    private authSvc:     AuthService,
    private commentsSvc: ObjectiveCommentsService,
    private alertCtrl:   AlertController,
  ) {}

  ngOnInit(): void {
    const user         = this.authSvc.getCurrentUser();
    this.currentUserId = user?.id ?? '';
    this.isOrgAdmin    = user?.type === 'teacher' && !user.professionalType;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['objectiveId'] || changes['targetUserId']) {
      this.comments   = [];
      this.editingId  = null;
      this.saveError  = '';
      this.loadComments();
    }
  }

  private async loadComments(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(
        this.commentsSvc.getObjectiveComments(this.objectiveId, this.targetUserId)
      );
      this.comments = res.comments;
      this.commentsCountChanged.emit(this.comments.length);
    } catch {
      this.loadError = 'No se pudieron cargar los comentarios.';
    } finally {
      this.isLoading = false;
    }
  }

  async addComment(): Promise<void> {
    const text = this.newText.trim();
    if (!text || this.isSaving) return;
    this.isSaving  = true;
    this.saveError = '';
    try {
      const res = await firstValueFrom(
        this.commentsSvc.addObjectiveComment(this.objectiveId, this.targetUserId, text)
      );
      this.comments = [...this.comments, res.comment];
      this.newText  = '';
      this.commentsCountChanged.emit(this.comments.length);
    } catch (err: any) {
      this.saveError = err?.error?.error ?? 'Error al guardar el comentario.';
    } finally {
      this.isSaving = false;
    }
  }

  startEdit(comment: ObjectiveComment): void {
    this.editingId = comment._id;
    this.editText  = comment.text;
    this.saveError = '';
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editText  = '';
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId || !this.editText.trim() || this.isUpdating) return;
    this.isUpdating = true;
    this.saveError  = '';
    try {
      const res = await firstValueFrom(
        this.commentsSvc.updateObjectiveComment(
          this.objectiveId, this.editingId, this.editText.trim()
        )
      );
      this.comments = this.comments.map(c =>
        c._id === this.editingId ? res.comment : c
      );
      this.cancelEdit();
    } catch (err: any) {
      this.saveError = err?.error?.error ?? 'Error al actualizar el comentario.';
    } finally {
      this.isUpdating = false;
    }
  }

  async confirmAndDelete(commentId: string): Promise<void> {
    const a = await this.alertCtrl.create({
      header:  'Eliminar comentario',
      message: '¿Seguro que quieres eliminar este comentario? Esta acción no se puede deshacer.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive',
          handler: () => { void this.deleteComment(commentId); } },
      ],
    });
    await a.present();
  }

  async deleteComment(commentId: string): Promise<void> {
    this.saveError = '';
    try {
      await firstValueFrom(
        this.commentsSvc.deleteObjectiveComment(this.objectiveId, commentId)
      );
      this.comments = this.comments.filter(c => c._id !== commentId);
      this.commentsCountChanged.emit(this.comments.length);
    } catch (err: any) {
      this.saveError = err?.error?.error ?? 'Error al eliminar el comentario.';
    }
  }
}
