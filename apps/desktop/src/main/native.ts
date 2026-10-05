import { createRequire } from 'node:module';
import type { InputDriver, MouseButton } from '@toktok/integrations';
import { app, safeStorage } from 'electron';
import type { SecretCipher } from '@toktok/core';

/**
 * Development only (Linux without a keyring, CI, headless tests): allow Electron's
 * obfuscation-only backend when explicitly requested. Never active in packaged builds
 * nor on Windows, where DPAPI is always available.
 */
export function configureSafeStorageForDev(): void {
  if (process.platform === 'linux' && !app.isPackaged && process.env.TOKTOK_DEV_PLAINTEXT_SECRETS === '1') {
    safeStorage.setUsePlainTextEncryption(true);
  }
}

/** Secrets are encrypted with the OS keychain (DPAPI on Windows) via Electron safeStorage. */
export const safeStorageCipher: SecretCipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher),
};

interface RobotJs {
  keyTap(key: string, modifier?: string | string[]): void;
  keyToggle(key: string, down: 'down' | 'up', modifier?: string | string[]): void;
  typeString(text: string): void;
  moveMouse(x: number, y: number): void;
  getMousePos(): { x: number; y: number };
  mouseClick(button?: string, double?: boolean): void;
  mouseToggle(down?: 'down' | 'up', button?: string): void;
  scrollMouse(x: number, y: number): void;
  setKeyboardDelay(ms: number): void;
  setMouseDelay(ms: number): void;
}

/** Loads @jitsi/robotjs (native, MIT). Returns undefined when unavailable on this system. */
export function loadInputDriver(log: (msg: string) => void): InputDriver | undefined {
  let robot: RobotJs;
  try {
    const require = createRequire(import.meta.url);
    robot = require('@jitsi/robotjs') as RobotJs;
    robot.setKeyboardDelay(0);
    robot.setMouseDelay(0);
  } catch (err) {
    log(`Simulation clavier indisponible : ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  return {
    keyTap: (key, mods) => robot.keyTap(key, mods),
    keyToggle: (key, down, mods) => robot.keyToggle(key, down ? 'down' : 'up', mods),
    typeString: (text) => robot.typeString(text),
    moveMouse: (x, y) => robot.moveMouse(x, y),
    moveMouseRelative: (dx, dy) => {
      const p = robot.getMousePos();
      robot.moveMouse(p.x + dx, p.y + dy);
    },
    mouseClick: (button: MouseButton, double) => robot.mouseClick(button, double),
    mouseToggle: (button: MouseButton, down) => robot.mouseToggle(down ? 'down' : 'up', button),
    scrollMouse: (dx, dy) => robot.scrollMouse(dx, dy),
  };
}
