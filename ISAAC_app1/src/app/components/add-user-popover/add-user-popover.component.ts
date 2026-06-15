import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { PopoverController } from '@ionic/angular/standalone';

export type AddUserAction =
  | 'add-final-user'
  | 'add-family-member'
  | 'add-professional'
  | 'own-pictograms'
  | 'assign-professional';

interface PopoverOption {
  action:   AddUserAction;
  img:      string;
  label:    string;
  subtitle: string;
}

@Component({
  selector: 'app-add-user-popover',
  templateUrl: './add-user-popover.component.html',
  styleUrls:   ['./add-user-popover.component.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class AddUserPopoverComponent {

  readonly options: PopoverOption[] = [
    {
      action:   'add-final-user',
      img:      'assets/pictograms/final-user.png',
      label:    'Usuario final',
      subtitle: 'Crear nuevo perfil de usuario',
    },
    {
      action:   'add-family-member',
      img:      'assets/pictograms/family.png',
      label:    'Familiar',
      subtitle: 'Añadir familiar con permisos',
    },
    {
      action:   'add-professional',
      img:      'assets/pictograms/professionals.png',
      label:    'Profesional',
      subtitle: 'Terapeuta, educador, etc.',
    },
    {
      action:   'own-pictograms',
      img:      'assets/pictograms/custom-pictograms.png',
      label:    'Pictogramas propios',
      subtitle: 'Gestionar pictogramas del centro',
    },
    {
      action:   'assign-professional',
      img:      'assets/pictograms/assigned-professionals.png',
      label:    'Asignar profesional',
      subtitle: 'Vincular profesional a usuario',
    },
  ];

  constructor(private popoverCtrl: PopoverController) {}

  async select(action: AddUserAction): Promise<void> {
    await this.popoverCtrl.dismiss({ action });
  }
}
