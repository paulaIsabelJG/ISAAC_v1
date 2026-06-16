import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { PopoverController } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { AuthService, User } from '../../services/auth.service';
import { UserService, BackendUser, AssignedUserEntry, AssignedProfessionalPayload } from '../../services/user.service';
import {
  OrganizationUsersService,
  UserCardData,
  UsersTab,
} from '../../services/organization-users.service';
import { BoardService, Board } from '../../services/board.service';
import { PictogramStateService } from '../../services/pictogram-state.service';
import { OrgSidebarComponent } from '../../components/org-sidebar/org-sidebar.component';
import { AddUserPopoverComponent } from '../../components/add-user-popover/add-user-popover.component';
import { ProfPermsPopoverComponent } from '../../components/prof-perms-popover/prof-perms-popover.component';

@Component({
  selector: 'app-organization-users',
  templateUrl: './organization-users.page.html',
  styleUrls: ['./organization-users.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, OrgSidebarComponent],
})
export class OrganizationUsersPage implements OnInit, OnDestroy {

  user: User | null = null;

  allFinalUsers:    UserCardData[] = [];
  allProfessionals: UserCardData[] = [];
  allFamiliares:    UserCardData[] = [];
  isLoading = false;
  loadError = '';

  // ── Estado desde servicio ────────────────────────────────────────────────────
  activeTab:    UsersTab        = 'finales';
  selectedUser: UserCardData | null = null;
  searchQuery  = '';

  selectedUserBoards:     Board[]             = [];
  selectedLinkedUsers:    UserCardData[]       = [];
  assignedUsersWithPerms: AssignedUserEntry[]  = [];
  boardsLoading = false;

  private subs = new Subscription();

  constructor(
    private authService:    AuthService,
    private userService:    UserService,
    private usersService:   OrganizationUsersService,
    private boardService:   BoardService,
    private pictogramState: PictogramStateService,
    private popoverCtrl:    PopoverController,
    private alertCtrl:      AlertController,
    private toastCtrl:      ToastController,
    private router:         Router,
    private sanitizer:      DomSanitizer,
  ) {}

  ngOnInit(): void {
    this.subs.add(this.usersService.activeTab$.subscribe(t => this.activeTab = t));
    this.subs.add(this.usersService.selectedUser$.subscribe(u => {
      this.selectedUser = u;
      this.loadBoardsForUser(u);
    }));
    this.subs.add(this.usersService.searchQuery$.subscribe(q => this.searchQuery = q));
  }

  private loadBoardsForUser(u: UserCardData | null): void {
    this.selectedUserBoards     = [];
    this.selectedLinkedUsers    = [];
    this.assignedUsersWithPerms = [];
    if (!u) return;
    this.boardsLoading = true;

    if (u.type === 'teacher') {
      this.userService.getAssignedUsers(u._id).subscribe({
        next: (res) => {
          this.assignedUsersWithPerms = res.users;
          this.selectedLinkedUsers = res.users.map(a => ({
            _id:     a.userId,
            name:    a.name,
            surname: a.surname,
            email:   a.email,
            image:   a.image ?? undefined,
            type:    'user' as const,
          }));
          this.boardsLoading = false;
        },
        error: () => { this.boardsLoading = false; },
      });
    } else if (u.type === 'parent') {
      this.userService.getChildrenByParentId(u._id).subscribe({
        next: (res) => {
          this.selectedLinkedUsers = res.children.map(c => this.toCard(c));
          this.boardsLoading = false;
        },
        error: () => { this.boardsLoading = false; },
      });
    } else {
      this.boardService.getBoardsByUser(u._id).subscribe({
        next: (res) => {
          this.selectedUserBoards = res.boards.filter(
            b => b.boardRole === 'main' || !b.boardRole
          );
          this.boardsLoading = false;
        },
        error: () => { this.boardsLoading = false; },
      });
    }
  }

  ionViewWillEnter(): void {
    this.user = this.authService.getCurrentUser();
    this.loadUsers();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private loadUsers(): void {
    const centro = this.user?.centro;
    if (!centro) {
      this.loadError = 'No se encontró el centro asociado a esta cuenta.';
      return;
    }
    this.isLoading = true;
    this.loadError = '';

    // Paso 1: usuarios del centro (teachers + users finales).
    // Los familiares (type='parent') NO tienen centro, por lo que no aparecen aquí.
    this.userService.getUsersByCenter(centro).subscribe({
      next: (res) => {
        const myEmail = this.user?.email;
        this.allFinalUsers    = res.users.filter(u => u.type === 'user').map(u => this.toCard(u));
        this.allProfessionals = res.users.filter(u => u.type === 'teacher' && u.email !== myEmail).map(u => this.toCard(u));

        // Paso 2: familiares vinculados a los usuarios finales del centro.
        const finalUserIds = this.allFinalUsers.map(u => u._id);
        if (finalUserIds.length === 0) {
          this.allFamiliares = [];
          this.isLoading = false;
          return;
        }

        this.userService.getFamiliesForUsers(finalUserIds).subscribe({
          next: (famRes) => {
            this.allFamiliares = famRes.families.map(u => ({ ...this.toCard(u), type: 'parent' as const }));
            this.isLoading = false;
          },
          error: () => {
            // No bloquear la vista si falla la carga de familiares
            this.allFamiliares = [];
            this.isLoading = false;
          },
        });
      },
      error: () => {
        this.loadError = 'Error al cargar usuarios. Inténtalo de nuevo.';
        this.isLoading = false;
      },
    });
  }

  private toCard(u: BackendUser): UserCardData {
    return {
      _id:     u._id,
      name:    u.name,
      surname: u.surname ?? '',
      email:   u.email,
      image:   u.image ?? undefined,
      type:    u.type,
    };
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  get activeUsers(): UserCardData[] {
    switch (this.activeTab) {
      case 'finales':       return this.allFinalUsers;
      case 'profesionales': return this.allProfessionals;
      case 'familiares':    return this.allFamiliares;
    }
  }

  get filteredUsers(): UserCardData[] {
    return this.usersService.filter(this.activeUsers, this.searchQuery);
  }

  get activeCount(): number { return this.activeUsers.length; }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  setTab(tab: UsersTab): void        { this.usersService.setTab(tab); }
  selectUser(u: UserCardData): void  { this.usersService.selectUser(u); }
  clearSelection(): void             { this.usersService.clearSelection(); }

  async confirmDeleteUser(u: UserCardData): Promise<void> {
    const typeLabel = u.type === 'user' ? 'usuario final' : u.type === 'teacher' ? 'profesional' : 'familiar';
    const alert = await this.alertCtrl.create({
      header: 'Eliminar usuario',
      message: `¿Deseas eliminar definitivamente a ${u.name} ${u.surname} como ${typeLabel}? Esta acción no se puede deshacer.`,
      buttons: [
        { text: 'No', role: 'cancel' },
        {
          text: 'Sí, eliminar',
          role: 'destructive',
          handler: () => this.deleteUser(u),
        },
      ],
    });
    await alert.present();
  }

  private deleteUser(u: UserCardData): void {
    this.userService.deleteUser(u._id).subscribe({
      next: async () => {
        this.usersService.clearSelection();
        this.loadUsers();
        const toast = await this.toastCtrl.create({
          message: `${u.name} ${u.surname} ha sido eliminado.`,
          duration: 2500,
          color: 'danger',
          position: 'bottom',
        });
        await toast.present();
      },
      error: async () => {
        const toast = await this.toastCtrl.create({
          message: 'No se pudo eliminar el usuario. Inténtalo de nuevo.',
          duration: 3000,
          color: 'danger',
          position: 'bottom',
        });
        await toast.present();
      },
    });
  }

  onSearch(event: Event): void {
    const val = (event as CustomEvent<{ value: string }>).detail?.value ?? '';
    this.usersService.setSearch(val);
  }

  isSelected(u: UserCardData): boolean {
    return this.selectedUser?._id === u._id;
  }

  getInitial(u: UserCardData): string {
    return u.name.charAt(0).toUpperCase();
  }

  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }

  boardShapeLabel(board: Board): string {
    if (board.shape === 'circular') return 'Circular';
    if (board.boardRole === 'multi' || board.shape === 'multi') return 'Multi';
    return 'Cuadrícula';
  }

  boardDimensionLabel(board: Board): string {
    if (board.shape === 'circular') return `${board.circleSlots} pos.`;
    if (board.boardRole === 'multi' || board.shape === 'multi') return `${board.slotCount ?? 2} huecos`;
    return `${board.rows}×${board.columns}`;
  }

  boardBadges(board: Board): Array<{ label: string; cls: string }> {
    const b: Array<{ label: string; cls: string }> = [];
    if (board.visibleInProfile) b.push({ label: 'PUBLICADO', cls: 'ou-badge--pub' });
    if (board.predictorEnabled) b.push({ label: 'IA',        cls: 'ou-badge--ia'  });
    if (board.aiRewriteEnabled) b.push({ label: 'IA TEXTO',  cls: 'ou-badge--ia'  });
    return b;
  }

  // ── Permisos del profesional sobre un usuario ────────────────────────────────

  async openPermsPopover(entry: AssignedUserEntry, event: Event): Promise<void> {
    if (!this.selectedUser) return;
    const professionalId = this.selectedUser._id;

    const popover = await this.popoverCtrl.create({
      component: ProfPermsPopoverComponent,
      componentProps: {
        userName:     `${entry.name} ${entry.surname}`,
        userInitial:  entry.name.charAt(0).toUpperCase(),
        initialPerms: {
          canViewStats:           entry.canViewStats,
          canEditBoards:          entry.canEditBoards,
          canEditPersonalData:    entry.canEditPersonalData,
          canAddPictograms:       entry.canAddPictograms,
          canAssignProfessionals: entry.canAssignProfessionals,
          canAssignFamilies:      entry.canAssignFamilies,
          canViewAssignedBoards:  entry.canViewAssignedBoards,
        },
      },
      event,
      translucent:     false,
      showBackdrop:    true,
      backdropDismiss: true,
      cssClass:        'isaac-perms-popover',
      alignment:       'center',
      side:            'left',
    });

    await popover.present();

    const { data } = await popover.onDidDismiss<{ perms: Record<string, boolean> }>();
    if (!data?.perms) return;

    const perms = data.perms;
    this.userService.getAssignedProfessionals(entry.userId).subscribe({
      next: (res) => {
        const payload: AssignedProfessionalPayload[] = res.assignedProfessionals.map(p => ({
          professionalId:         p.professionalId,
          canViewStats:           p.professionalId === professionalId ? perms['canViewStats']           : p.canViewStats,
          canEditBoards:          p.professionalId === professionalId ? perms['canEditBoards']          : p.canEditBoards,
          canEditPersonalData:    p.professionalId === professionalId ? perms['canEditPersonalData']    : p.canEditPersonalData,
          canAddPictograms:       p.professionalId === professionalId ? perms['canAddPictograms']       : p.canAddPictograms,
          canAssignProfessionals: p.professionalId === professionalId ? perms['canAssignProfessionals'] : p.canAssignProfessionals,
          canAssignFamilies:      p.professionalId === professionalId ? perms['canAssignFamilies']      : p.canAssignFamilies,
          canViewAssignedBoards:  p.professionalId === professionalId ? perms['canViewAssignedBoards']  : p.canViewAssignedBoards,
        }));

        this.userService.updateAssignedProfessionals(entry.userId, payload).subscribe({
          next: async () => {
            const idx = this.assignedUsersWithPerms.findIndex(u => u.userId === entry.userId);
            if (idx !== -1) {
              this.assignedUsersWithPerms[idx] = { ...this.assignedUsersWithPerms[idx], ...perms };
            }
            const toast = await this.toastCtrl.create({
              message: '✓ Permisos actualizados', duration: 2000, color: 'success', position: 'top',
            });
            await toast.present();
          },
          error: async () => {
            const toast = await this.toastCtrl.create({
              message: 'Error al guardar permisos', duration: 3000, color: 'danger', position: 'top',
            });
            await toast.present();
          },
        });
      },
      error: async () => {
        const toast = await this.toastCtrl.create({
          message: 'Error al cargar datos del usuario', duration: 3000, color: 'danger', position: 'top',
        });
        await toast.present();
      },
    });
  }

  goToPersonalData(u: UserCardData): void {
    if (u.type === 'user') {
      this.router.navigate(['/user-final-form', u._id], {
        queryParams: { returnTo: '/organization-users' },
      });
    } else if (u.type === 'teacher') {
      this.router.navigate(['/add-user'], {
        queryParams: { type: 'professional', userId: u._id, returnTo: '/organization-users' },
      });
    } else if (u.type === 'parent') {
      this.router.navigate(['/add-user'], {
        queryParams: { type: 'parent', userId: u._id, returnTo: '/organization-users' },
      });
    }
  }

  goToSession(u: UserCardData): void {
    if (u.type === 'user') {
      this.router.navigate(['/user-session', u._id]);
    } else if (u.type === 'teacher') {
      this.router.navigate(['/professional-session', u._id]);
    } else {
      this.router.navigate(['/user-placeholder']);
    }
  }

  async openAddPopover(event: Event): Promise<void> {
    const popover = await this.popoverCtrl.create({
      component:       AddUserPopoverComponent,
      event,
      translucent:     false,
      showBackdrop:    true,
      backdropDismiss: true,
      cssClass:        'isaac-add-popover',
      alignment:       'end',
      side:            'bottom',
    });

    await popover.present();

    const { data } = await popover.onDidDismiss<{ action: string }>();
    if (!data?.action) return;

    switch (data.action) {
      case 'add-final-user':     this.onAddFinalUser();      break;
      case 'add-family-member':  this.onAddFamilyMember();   break;
      case 'add-professional':   this.onAddProfessional();   break;
      case 'own-pictograms':     this.onOwnPictograms();     break;
      case 'assign-professional': this.onAssignProfessional(); break;
    }
  }

  private onAddFinalUser(): void {
    this.router.navigate(['/user-final-form', 'new'], {
      queryParams: { returnTo: '/organization-users' },
    });
  }

  private onAddFamilyMember(): void {
    this.router.navigate(['/add-user'], {
      queryParams: { type: 'parent', returnTo: '/organization-users' },
    });
  }

  private onAddProfessional(): void {
    this.router.navigate(['/add-user'], {
      queryParams: { returnTo: '/organization-users' },
    });
  }

  private onOwnPictograms(): void {
    this.pictogramState.userId       = null;
    this.pictogramState.returnTo     = '/organization-users';
    this.pictogramState.allowedUsers = null;
    this.router.navigate(['/own-pictograms-placeholder']);
  }

  private onAssignProfessional(): void {
    this.pictogramState.userId       = null;
    this.pictogramState.returnTo     = '/organization-users';
    this.pictogramState.allowedUsers = null;
    this.router.navigate(['/assigned-professionals-placeholder']);
  }
}
