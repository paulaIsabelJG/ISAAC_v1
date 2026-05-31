import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { HasUnsavedChanges } from './has-unsaved-changes';
import { UnsavedChangesService } from './unsaved-changes.service';

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) return true;
  return inject(UnsavedChangesService).confirm();
};
