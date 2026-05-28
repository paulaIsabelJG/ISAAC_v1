import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Location } from '@angular/common';

@Component({
  selector: 'app-statistics-placeholder',
  templateUrl: './statistics-placeholder.page.html',
  styleUrls:  ['./statistics-placeholder.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class StatisticsPlaceholderPage {
  constructor(private location: Location) {}

  goBack() { this.location.back(); }
}
