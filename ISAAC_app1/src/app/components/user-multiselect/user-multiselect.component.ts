import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface UserSelectOption {
  _id:      string;
  name:     string;
  surname?: string | null;
  email?:   string | null;
}

@Component({
  selector:    'app-user-multiselect',
  templateUrl: './user-multiselect.component.html',
  styleUrls:   ['./user-multiselect.component.scss'],
  standalone:  true,
  imports:     [IonicModule, CommonModule, FormsModule],
})
export class UserMultiselectComponent {
  @Input() options:     UserSelectOption[] = [];
  @Input() selectedIds: string[]           = [];
  @Input() placeholder  = 'Buscar...';
  @Input() showEmail    = false;

  @Output() selectedIdsChange = new EventEmitter<string[]>();

  searchQuery  = '';
  dropdownOpen = false;

  // ── Getters ───────────────────────────────────────────────────────────────

  get selectedOptions(): UserSelectOption[] {
    return this.selectedIds
      .map(id => this.options.find(o => o._id === id))
      .filter((o): o is UserSelectOption => !!o);
  }

  get filteredOptions(): UserSelectOption[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.options;
    return this.options.filter(o =>
      [o.name, o.surname ?? ''].join(' ').toLowerCase().includes(q)
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  fullName(opt: UserSelectOption): string {
    return [opt.name, opt.surname].filter(Boolean).join(' ');
  }

  initial(opt: UserSelectOption): string {
    return opt.name.charAt(0).toUpperCase();
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  // ── Acciones ──────────────────────────────────────────────────────────────

  openDropdown(): void {
    this.dropdownOpen = true;
  }

  toggle(id: string): void {
    const next = this.isSelected(id)
      ? this.selectedIds.filter(x => x !== id)
      : [...this.selectedIds, id];
    this.selectedIdsChange.emit(next);
  }

  remove(id: string): void {
    this.selectedIdsChange.emit(this.selectedIds.filter(x => x !== id));
  }

  clearSearch(): void {
    this.searchQuery = '';
  }

  // Cierra el desplegable cuando se hace clic fuera del componente
  @HostListener('document:click')
  onDocumentClick(): void {
    this.dropdownOpen = false;
  }
}
