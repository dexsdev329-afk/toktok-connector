/** Native input backend (robotjs in the desktop app, a recorder in tests). */
export interface InputDriver {
  keyTap(key: string, modifiers: string[]): void;
  keyToggle(key: string, down: boolean, modifiers: string[]): void;
  typeString(text: string): void;
  moveMouse(x: number, y: number): void;
  /** Relative move from the current position. */
  moveMouseRelative(dx: number, dy: number): void;
  mouseClick(button: MouseButton, double: boolean): void;
  mouseToggle(button: MouseButton, down: boolean): void;
  scrollMouse(dx: number, dy: number): void;
}

export type MouseButton = 'left' | 'right' | 'middle';

export const MODIFIERS = ['control', 'shift', 'alt', 'command'] as const;

const NAMED_KEYS = [
  'backspace',
  'delete',
  'enter',
  'tab',
  'escape',
  'up',
  'down',
  'right',
  'left',
  'home',
  'end',
  'pageup',
  'pagedown',
  'space',
  'insert',
  'printscreen',
  'capslock',
  'menu',
  'control',
  'shift',
  'alt',
  'command',
  'right_shift',
  'right_control',
  'right_alt',
  'audio_mute',
  'audio_vol_down',
  'audio_vol_up',
  'audio_play',
  'audio_stop',
  'audio_pause',
  'audio_prev',
  'audio_next',
  'numpad_0',
  'numpad_1',
  'numpad_2',
  'numpad_3',
  'numpad_4',
  'numpad_5',
  'numpad_6',
  'numpad_7',
  'numpad_8',
  'numpad_9',
  'numpad_+',
  'numpad_-',
  'numpad_*',
  'numpad_/',
  'numpad_.',
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
];

const ALIASES: Record<string, string> = {
  ctrl: 'control',
  ctl: 'control',
  win: 'command',
  windows: 'command',
  cmd: 'command',
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  ins: 'insert',
  pgup: 'pageup',
  pgdn: 'pagedown',
  spacebar: 'space',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
};

const VALID = new Set(NAMED_KEYS);

/** Normalizes a key name; returns null when unknown. Single printable characters are allowed. */
export function normalizeKey(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  const aliased = ALIASES[k] ?? k;
  if (VALID.has(aliased)) return aliased;
  if ([...aliased].length === 1 && /[a-z0-9`\-=[\]\\;',./]/.test(aliased)) return aliased;
  return null;
}
