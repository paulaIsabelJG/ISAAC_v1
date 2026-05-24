import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';

@Component({
  selector: 'app-board-builder',
  templateUrl: './board-builder.page.html',
  styleUrls: ['./board-builder.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class BoardBuilderPage {
  constructor(private router: Router) {}

  goBack() {
    this.router.navigate(['/organization-dashboard']);
  }
}
