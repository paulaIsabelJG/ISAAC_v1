import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ObjectiveService, Objective, ObjectiveEffectiveStatus } from '../../services/objective.service';

@Component({
  selector:    'app-user-objectives-panel',
  templateUrl: './user-objectives-panel.component.html',
  styleUrls:   ['./user-objectives-panel.component.scss'],
  standalone:  true,
  imports:     [CommonModule, IonicModule],
})
export class UserObjectivesPanelComponent implements OnInit {
  @Input() userId   = '';
  @Input() canCreate = false;

  objectives: Objective[] = [];
  loading     = true;
  error       = '';
  filterStatus = 'all';

  constructor(
    private objSvc: ObjectiveService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error   = '';
    try {
      const res = await firstValueFrom(this.objSvc.getUserObjectives(this.userId));
      this.objectives = res.objectives;
    } catch {
      this.error = 'Error al cargar los objetivos.';
    } finally {
      this.loading = false;
    }
  }

  get filtered(): Objective[] {
    if (this.filterStatus === 'all') return this.objectives;
    return this.objectives.filter(o => o.effectiveStatus === this.filterStatus);
  }

  setFilter(s: string): void { this.filterStatus = s; }

  statusLabel(s: ObjectiveEffectiveStatus): string { return this.objSvc.statusLabel(s); }
  statusColor(s: ObjectiveEffectiveStatus): string { return this.objSvc.statusColor(s); }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  goToCreate(): void {
    this.router.navigate(['/objective-form'], {
      queryParams: { returnTo: '/user-session/' + this.userId },
    });
  }

  goToEdit(obj: Objective): void {
    this.router.navigate(['/objective-form', obj._id], {
      queryParams: { returnTo: '/user-session/' + this.userId },
    });
  }
}
