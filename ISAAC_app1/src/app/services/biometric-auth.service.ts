import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

const RT_KEY      = 'isaac_rt';       // refresh token en Keychain/Keystore
const ENABLED_KEY = 'isaac_bio_on';   // flag de biometría activada

@Injectable({ providedIn: 'root' })
export class BiometricAuthService {

  /** true si el dispositivo tiene biometría disponible y configurada. */
  async isAvailable(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      const { NativeBiometric } = await import('capacitor-native-biometric');
      const result = await NativeBiometric.isAvailable();
      return !!result.isAvailable;
    } catch {
      return false;
    }
  }

  /** true si el usuario ya activó el acceso biométrico en este dispositivo. */
  async isEnabled(): Promise<boolean> {
    try {
      const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
      const { value } = await SecureStoragePlugin.get({ key: ENABLED_KEY });
      return value === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Pide verificación biométrica y guarda el refreshToken en Keychain/Keystore.
   * Lanza si el usuario cancela o la biometría falla.
   */
  async activate(refreshToken: string): Promise<void> {
    await this.verify('Activa el acceso biométrico para ISAAC');
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    await SecureStoragePlugin.set({ key: RT_KEY,      value: refreshToken });
    await SecureStoragePlugin.set({ key: ENABLED_KEY, value: 'true' });
  }

  /**
   * Pide verificación biométrica y devuelve el refreshToken almacenado.
   * Lanza si el usuario cancela, la biometría falla o no hay token guardado.
   */
  async authenticate(): Promise<string> {
    await this.verify('Usa Face ID, Touch ID o huella para entrar en ISAAC');
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    const { value } = await SecureStoragePlugin.get({ key: RT_KEY });
    if (!value) throw new Error('No hay refresh token almacenado');
    return value;
  }

  /** Revoca el acceso biométrico y borra el token del almacenamiento seguro. */
  async deactivate(): Promise<void> {
    try {
      const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
      await SecureStoragePlugin.remove({ key: RT_KEY });
      await SecureStoragePlugin.remove({ key: ENABLED_KEY });
    } catch { /* silencioso — ya estaba borrado */ }
  }

  private async verify(reason: string): Promise<void> {
    const { NativeBiometric } = await import('capacitor-native-biometric');
    await NativeBiometric.verifyIdentity({
      reason,
      title:              'ISAAC',
      subtitle:           'Verificación biométrica',
      description:        'Face ID, Touch ID o huella dactilar',
      negativeButtonText: 'Cancelar',
      maxAttempts:        3,
    });
  }
}
