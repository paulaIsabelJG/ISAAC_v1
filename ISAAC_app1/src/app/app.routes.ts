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
    path: 'board-builder-create',
    loadComponent: () =>
      import('./board-builder-create/board-builder-create.page').then(
        (m) => m.BoardBuilderCreatePage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'board-builder-editor/:boardId',
    loadComponent: () =>
      import('./board-builder-editor/board-builder-editor.page').then(
        (m) => m.BoardBuilderEditorPage
      ),
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
  {
    path: 'own-pictograms-placeholder',
    loadComponent: () =>
      import('./own-pictograms-placeholder/own-pictograms-placeholder.page').then(
        (m) => m.OwnPictogramsPlaceholderPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'assigned-professionals-placeholder',
    loadComponent: () =>
      import('./assigned-professionals-placeholder/assigned-professionals-placeholder.page').then(
        (m) => m.AssignedProfessionalsPlaceholderPage
      ),
    canActivate: [authGuard],
  },

  // ── Formulario completo de edición de usuario final ─────────────────────────
  {
    path: 'user-final-form/:userId',
    loadComponent: () =>
      import('./user-final-form/user-final-form.page').then(
        (m) => m.UserFinalFormPage
      ),
    canActivate: [authGuard],
  },

  // ── Sesión / perfil de usuario final ────────────────────────────────────────
  {
    path: 'user-session/:userId',
    loadComponent: () =>
      import('./user-session/user-session.page').then((m) => m.UserSessionPage),
    canActivate: [authGuard],
  },

  // ── Datos personales del usuario final ──────────────────────────────────────
  {
    path: 'user-personal-data/:userId',
    loadComponent: () =>
      import('./user-personal-data/user-personal-data.page').then(
        (m) => m.UserPersonalDataPage
      ),
    canActivate: [authGuard],
  },

  // ── Placeholder Estadísticas ─────────────────────────────────────────────────
  {
    path: 'statistics-placeholder',
    loadComponent: () =>
      import('./statistics-placeholder/statistics-placeholder.page').then(
        (m) => m.StatisticsPlaceholderPage
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
