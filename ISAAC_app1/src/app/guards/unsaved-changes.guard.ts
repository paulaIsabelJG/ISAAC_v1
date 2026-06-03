import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { HasUnsavedChanges } from './has-unsaved-changes';
import { UnsavedChangesService } from './unsaved-changes.service';

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) return true;
  // Sesión expirada: no bloquear la redirección al login aunque haya cambios pendientes.
  if (!localStorage.getItem('isaac_token')) return true;
  return inject(UnsavedChangesService).confirm();
};
