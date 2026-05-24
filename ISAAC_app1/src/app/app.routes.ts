import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  // ── Rutas públicas ──────────────────────────────────────────────────────────
  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register.page').then((m) => m.RegisterPage),
  },

  // ── Rutas privadas (requieren sesión) ───────────────────────────────────────
  {
    path: 'organization-dashboard',
    loadComponent: () =>
      import('./organization-dashboard/organization-dashboard.page').then(
        (m) => m.OrganizationDashboardPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'organization-profile',
    loadComponent: () =>
      import('./organization-profile/organization-profile.page').then(
        (m) => m.OrganizationProfilePage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'add-user',
    loadComponent: () =>
      import('./add-user/add-user.page').then((m) => m.AddUserPage),
    canActivate: [authGuard],
  },
  {
    path: 'board-builder',
    loadComponent: () =>
      import('./board-builder/board-builder.page').then((m) => m.BoardBuilderPage),
    canActivate: [authGuard],
  },
  {
    path: 'user-placeholder',
    loadComponent: () =>
      import('./user-placeholder/user-placeholder.page').then(
        (m) => m.UserPlaceholderPage
      ),
    canActivate: [authGuard],
  },

  // ── Redirección por defecto ─────────────────────────────────────────────────
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];
