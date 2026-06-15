import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface UserCardData {
  _id:     string;
  name:    string;
  surname: string;
  email:   string;
  image?:  string;
  type:    'user' | 'parent' | 'teacher';
}

export type UsersTab = 'finales' | 'profesionales' | 'familiares';

@Injectable({ providedIn: 'root' })
export class OrganizationUsersService {

  private _activeTab$    = new BehaviorSubject<UsersTab>('finales');
  private _selectedUser$ = new BehaviorSubject<UserCardData | null>(null);
  private _searchQuery$  = new BehaviorSubject<string>('');

  readonly activeTab$    = this._activeTab$.asObservable();
  readonly selectedUser$ = this._selectedUser$.asObservable();
  readonly searchQuery$  = this._searchQuery$.asObservable();

  setTab(tab: UsersTab): void {
    this._activeTab$.next(tab);
    this._searchQuery$.next('');
    this._selectedUser$.next(null);
  }

  selectUser(user: UserCardData): void {
    const current = this._selectedUser$.getValue();
    this._selectedUser$.next(current?._id === user._id ? null : user);
  }

  clearSelection(): void {
    this._selectedUser$.next(null);
  }

  setSearch(query: string): void {
    this._searchQuery$.next(query);
  }

  filter(users: UserCardData[], query: string): UserCardData[] {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      `${u.name} ${u.surname}`.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  }
}
