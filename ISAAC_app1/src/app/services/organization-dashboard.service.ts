import { Injectable } from '@angular/core';
import { UserCardData } from './organization-users.service';

export interface QuickSummary {
  totalFinalUsers:    number;
  totalProfessionals: number;
  totalFamiliares:    number;
}

@Injectable({ providedIn: 'root' })
export class OrganizationDashboardService {

  /** Devuelve los primeros N usuarios para el panel de vista previa de Home */
  getRecentUsers(users: UserCardData[], limit = 5): UserCardData[] {
    return users.slice(0, limit);
  }

  buildSummary(
    finalUsers:    UserCardData[],
    professionals: UserCardData[],
    familiares:    UserCardData[],
  ): QuickSummary {
    return {
      totalFinalUsers:    finalUsers.length,
      totalProfessionals: professionals.length,
      totalFamiliares:    familiares.length,
    };
  }
}
