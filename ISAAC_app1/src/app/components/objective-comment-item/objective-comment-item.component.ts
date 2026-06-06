import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ObjectiveComment } from '../../models/objective-comment.model';

@Component({
  selector: 'app-objective-comment-item',
  templateUrl: './objective-comment-item.component.html',
  styleUrls:   ['./objective-comment-item.component.scss'],
  standalone:   true,
  imports:     [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObjectiveCommentItemComponent {
  @Input() comment!:       ObjectiveComment;
  @Input() currentUserId!: string;
  @Input() isOrgAdmin      = false;

  @Output() editRequest   = new EventEmitter<ObjectiveComment>();
  @Output() deleteRequest = new EventEmitter<string>();

  get isOwn():    boolean { return this.comment?.createdBy?._id === this.currentUserId; }
  get canEdit():  boolean { return this.isOwn; }
  get canDelete(): boolean { return this.isOwn || this.isOrgAdmin; }

  get roleLabel(): string {
    const cb = this.comment?.createdBy;
    if (!cb) return '';
    if (cb.type === 'teacher') return cb.professionalType ? 'Profesional' : 'Organización';
    if (cb.type === 'parent')  return 'Familiar';
    if (cb.type === 'user')    return 'Usuario final';
    return '';
  }

  get roleClass(): string {
    const cb = this.comment?.createdBy;
    if (!cb) return '';
    if (cb.type === 'teacher') return cb.professionalType ? 'professional' : 'org';
    if (cb.type === 'parent')  return 'family';
    if (cb.type === 'user')    return 'user';
    return '';
  }

  get creatorName(): string {
    if (!this.comment?.createdBy) return 'Desconocido';
    return [this.comment.createdBy.name, this.comment.createdBy.surname]
      .filter(Boolean).join(' ');
  }

  get isEdited(): boolean {
    return this.comment?.updatedAt !== this.comment?.createdAt;
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  onEdit():   void { this.editRequest.emit(this.comment); }
  onDelete(): void { this.deleteRequest.emit(this.comment._id); }
}
