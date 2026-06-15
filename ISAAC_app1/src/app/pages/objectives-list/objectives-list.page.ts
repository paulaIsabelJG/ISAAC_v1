import { Component, OnInit } from '@angular/core';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ObjectiveService, Objective, ObjectiveEffectiveStatus } from '../../services/objective.service';
import { OrgSidebarComponent } from '../../components/org-sidebar/org-sidebar.component';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { ObjectiveCommentsComponent } from '../../components/objective-comments/objective-comments.component';

@Component({
  selector: 'app-objectives-list',
  templateUrl: './objectives-list.page.html',
  styleUrls:  ['./objectives-list.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, OrgSidebarComponent, LoadingErrorStateComponent, ObjectiveCommentsComponent],
})
export class ObjectivesListPage implements OnInit {

  /** 'creator' = org/profesional ve sus objetivos creados.
   *  'family'  = familiar ve los compartidos con él.
   *  'user'    = usuario final ve los suyos. */
  role: 'creator' | 'family' | 'user' = 'creator';

  /** userId para filtrar por usuario concreto (cuando un teacher lo pasa como query param) */
  filterUserId = '';

  returnTo = '/organization-dashboard';

  objectives:  Objective[] = [];
  isLoading  = true;
  loadError  = '';

  // Filtros activos
  filterStatus = 'all';

  expandedObjectiveId: string | null = null;

  // objectiveId → targetUserId → count (para calcular el badge en rol family)
  private readonly threadCounts = new Map<string, Map<string, number>>();

  updateThreadCount(objectiveId: string, targetUserId: string, count: number): void {
    if (!this.threadCounts.has(objectiveId)) {
      this.threadCounts.set(objectiveId, new Map());
    }
    this.threadCounts.get(objectiveId)!.set(targetUserId, count);
  }

  commentsCountFor(obj: Objective): number {
    if (this.role !== 'family') return obj.commentsCount;
    const tmap = this.threadCounts.get(obj._id);
    if (!tmap || tmap.size === 0) return obj.commentsCount;
    let sum = 0;
    for (const v of tmap.values()) sum += v;
    return sum;
  }

  get viewerType():   string  { return this.authSvc.getCurrentUser()?.type ?? ''; }
  get currentUserId(): string { return this.authSvc.getCurrentUser()?.id  ?? ''; }
  get isCreator():     boolean { return this.role === 'creator'; }
  get showOrgSidebar(): boolean { return this.returnTo.startsWith('/organization-dashboard'); }

  constructor(
    private route:     ActivatedRoute,
    private router:    Router,
    private authSvc:   AuthService,
    private objSvc:    ObjectiveService,
    private toast:     ToastController,
    private alert:     AlertController,
  ) {}

  ngOnInit() {
    this.role         = (this.route.snapshot.queryParamMap.get('role') as any) ?? 'creator';
    this.filterUserId = this.route.snapshot.queryParamMap.get('userId') ?? '';
    this.returnTo     = this.route.snapshot.queryParamMap.get('returnTo') ?? this.defaultReturn();
  }

  ionViewWillEnter() {
    this.loadObjectives();
  }

  private defaultReturn(): string {
    const user = this.authSvc.getCurrentUser();
    if (!user) return '/login';
    if (user.type === 'teacher') {
      return user.professionalType
        ? `/professional-session/${user.id}`
        : '/organization-dashboard';
    }
    if (user.type === 'parent') return '/user-placeholder';
    return `/user-session/${user.id}`;
  }

  // ── Carga ─────────────────────────────────────────────────────────────────

  async loadObjectives(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      if (this.role === 'family') {
        const res = await firstValueFrom(this.objSvc.getFamilyObjectives());
        this.objectives = res.objectives;
      } else if (this.role === 'user') {
        const userId = this.filterUserId || this.authSvc.getCurrentUser()?.id || '';
        const res = await firstValueFrom(this.objSvc.getUserObjectives(userId));
        this.objectives = res.objectives;
      } else {
        const res = await firstValueFrom(this.objSvc.getObjectives({
          status: this.filterStatus !== 'all' ? this.filterStatus : undefined,
          userId: this.filterUserId || undefined,
        }));
        this.objectives = res.objectives;
      }
    } catch {
      this.loadError = 'Error al cargar los objetivos. Inténtalo de nuevo.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Filtros ───────────────────────────────────────────────────────────────

  get filteredObjectives(): Objective[] {
    if (this.filterStatus === 'all') return this.objectives;
    return this.objectives.filter(o => o.effectiveStatus === this.filterStatus);
  }

  onFilterStatus(event: Event): void {
    this.filterStatus = (event as CustomEvent<{ value: string }>).detail?.value ?? 'all';
  }

  // ── Navegación ────────────────────────────────────────────────────────────

  goBack(): void {
    this.router.navigateByUrl(this.returnTo);
  }

  toggleObjective(id: string): void {
    this.expandedObjectiveId = this.expandedObjectiveId === id ? null : id;
  }

  goToCreate(): void {
    this.router.navigate(['/objective-form'], {
      queryParams: { returnTo: '/objectives-list' },
    });
  }

  goToEdit(obj: Objective): void {
    this.router.navigate(['/objective-form', obj._id], {
      queryParams: { returnTo: '/objectives-list' },
    });
  }

  // ── Acciones de estado ────────────────────────────────────────────────────

  async confirmCancel(obj: Objective): Promise<void> {
    const a = await this.alert.create({
      header:  'Cancelar objetivo',
      message: `¿Seguro que quieres cancelar "${obj.title}"? Esta acción no se puede deshacer.`,
      buttons: [
        { text: 'No', role: 'cancel' },
        {
          text:    'Sí, cancelar',
          handler: () => { void this.changeStatus(obj, 'cancelled'); },
        },
      ],
    });
    await a.present();
  }

  async confirmComplete(obj: Objective): Promise<void> {
    const a = await this.alert.create({
      header:  'Marcar como completado',
      message: `¿Marcar "${obj.title}" como completado?`,
      buttons: [
        { text: 'No', role: 'cancel' },
        {
          text:    'Sí, completar',
          handler: () => { void this.changeStatus(obj, 'completed'); },
        },
      ],
    });
    await a.present();
  }

  private async changeStatus(obj: Objective, status: 'completed' | 'cancelled'): Promise<void> {
    try {
      await firstValueFrom(this.objSvc.updateObjectiveStatus(obj._id, status));
      const idx = this.objectives.findIndex(o => o._id === obj._id);
      if (idx >= 0) {
        this.objectives[idx].status = status;
        this.objectives[idx].effectiveStatus = status;
      }
      await this.showToast(status === 'completed' ? 'Objetivo completado' : 'Objetivo cancelado', 'success');
    } catch {
      await this.showToast('Error al actualizar el estado.', 'danger');
    }
  }

  // ── Helpers de UI ─────────────────────────────────────────────────────────

  statusLabel(status: ObjectiveEffectiveStatus): string {
    return this.objSvc.statusLabel(status);
  }

  statusColor(status: ObjectiveEffectiveStatus): string {
    return this.objSvc.statusColor(status);
  }

  userNames(obj: Objective): string {
    return obj.assignedUserIds
      .map(u => [u.name, u.surname].filter(Boolean).join(' '))
      .join(', ');
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  canEdit(obj: Objective): boolean {
    if (!this.isCreator) return false;
    return obj.status !== 'cancelled';
  }

  canChangeStatus(obj: Objective): boolean {
    if (!this.isCreator) return false;
    const es = obj.effectiveStatus;
    return es === 'active' || es === 'expired';
  }

  private async showToast(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, duration: 2000, color, position: 'top' });
    await t.present();
  }
}
