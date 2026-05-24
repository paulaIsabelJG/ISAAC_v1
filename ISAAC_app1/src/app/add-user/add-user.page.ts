import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';

@Component({
  selector: 'app-add-user',
  templateUrl: './add-user.page.html',
  styleUrls: ['./add-user.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class AddUserPage {
  constructor(private router: Router) {}

  goBack() {
    this.router.navigate(['/organization-dashboard']);
  }

  // Pendiente: lógica real de creación de cada tipo de usuario
  onProfessional()  { /* próximamente */ }
  onFinalUser()     { /* próximamente */ }
  onFamilyMember()  { /* próximamente */ }
}
