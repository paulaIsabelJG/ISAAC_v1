import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Location } from '@angular/common';

@Component({
  selector: 'app-assigned-professionals-placeholder',
  templateUrl: './assigned-professionals-placeholder.page.html',
  styleUrls: ['./assigned-professionals-placeholder.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class AssignedProfessionalsPlaceholderPage {
  constructor(private location: Location) {}
  goBack() { this.location.back(); }
}
