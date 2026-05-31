import { Injectable } from '@angular/core';
import { AlertController } from '@ionic/angular';

@Injectable({ providedIn: 'root' })
export class UnsavedChangesService {
  constructor(private alertCtrl: AlertController) {}

  async confirm(): Promise<boolean> {
    return new Promise(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header: 'Cambios sin guardar',
        message: '¿Seguro que deseas salir? No has guardado los cambios.',
        buttons: [
          {
            text: 'Cancelar',
            role: 'cancel',
            handler: () => resolve(false),
          },
          {
            text: 'Salir sin guardar',
            role: 'destructive',
            handler: () => resolve(true),
          },
        ],
      });
      await alert.present();
    });
  }
}
