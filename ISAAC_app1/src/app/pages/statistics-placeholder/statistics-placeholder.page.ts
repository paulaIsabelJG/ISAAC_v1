import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Location } from '@angular/common';
import { TtsService } from '../../services/tts.service';

@Component({
  selector: 'app-statistics-placeholder',
  templateUrl: './statistics-placeholder.page.html',
  styleUrls:  ['./statistics-placeholder.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class StatisticsPlaceholderPage {
  constructor(private location: Location, private ttsSvc: TtsService) {}

  goBack() {
    this.ttsSvc.speakIfEnabled('volver');
    this.location.back();
  }
}
