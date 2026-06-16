import { Component, Input } from '@angular/core';
import { CommonModule }     from '@angular/common';
import { OrgSummary }       from '../../services/aac-statistics.service';

@Component({
  selector:    'app-statistics-summary-cards',
  templateUrl: './statistics-summary-cards.component.html',
  styleUrls:   ['./statistics-summary-cards.component.scss'],
  standalone:  true,
  imports:     [CommonModule],
})
export class StatisticsSummaryCardsComponent {
  @Input() summary:      OrgSummary | null = null;
  @Input() isLoading     = false;
  @Input() familyCount?: number;
}
