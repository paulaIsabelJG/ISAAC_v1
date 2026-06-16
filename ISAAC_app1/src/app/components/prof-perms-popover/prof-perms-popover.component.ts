import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { PopoverController } from '@ionic/angular/standalone';

const PERM_LABELS: { key: string; label: string }[] = [
  { key: 'canViewStats',           label: 'Ver estadísticas'       },
  { key: 'canEditBoards',          label: 'Editar tableros'         },
  { key: 'canEditPersonalData',    label: 'Editar datos personales' },
  { key: 'canAddPictograms',       label: 'Añadir pictogramas'      },
  { key: 'canAssignProfessionals', label: 'Asignar profesionales'   },
  { key: 'canAssignFamilies',      label: 'Asignar familiares'      },
  { key: 'canViewAssignedBoards',  label: 'Ver tableros asignados'  },
];

@Component({
  selector: 'app-prof-perms-popover',
  templateUrl: './prof-perms-popover.component.html',
  styleUrls:   ['./prof-perms-popover.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule],
})
export class ProfPermsPopoverComponent implements OnInit {

  @Input() userName    = '';
  @Input() userInitial = '';
  @Input() initialPerms: Record<string, boolean> = {};

  readonly permLabels = PERM_LABELS;
  perms: Record<string, boolean> = {};

  constructor(private popoverCtrl: PopoverController) {}

  ngOnInit(): void {
    this.perms = { ...this.initialPerms };
  }

  getPerm(key: string): boolean {
    return this.perms[key] ?? false;
  }

  onPermChange(key: string, evt: Event): void {
    this.perms[key] = (evt as CustomEvent<{ checked: boolean }>).detail.checked;
  }

  async save(): Promise<void> {
    await this.popoverCtrl.dismiss({ perms: this.perms });
  }

  async cancel(): Promise<void> {
    await this.popoverCtrl.dismiss(null);
  }
}
