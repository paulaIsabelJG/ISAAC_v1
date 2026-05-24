import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-board-builder',
  templateUrl: './board-builder.page.html',
  styleUrls: ['./board-builder.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class BoardBuilderPage implements OnInit {

  /** Ruta a la que volver: la impone el caller vía queryParam ?returnTo= */
  private returnTo = '/organization-dashboard';

  constructor(
    private route:  ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit() {
    const rt = this.route.snapshot.queryParamMap.get('returnTo');
    if (rt) { this.returnTo = rt; }
  }

  goBack() { this.router.navigateByUrl(this.returnTo); }
}
