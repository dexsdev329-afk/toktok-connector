import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLegacyJava } from './app-core';
import { writeProperties } from './minecraft-server';

describe('writeProperties', () => {
  it('updates existing keys, keeps the others and appends missing ones', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'mc-')), 'server.properties');
    writeFileSync(file, '#Minecraft server properties\nserver-ip=\nmotd=Hello\nenable-rcon=false\n');
    await writeProperties(file, { 'enable-rcon': 'true', 'server-ip': '127.0.0.1', 'rcon.port': '25575' });
    expect(readFileSync(file, 'utf8')).toBe(
      '#Minecraft server properties\nserver-ip=127.0.0.1\nmotd=Hello\nenable-rcon=true\nrcon.port=25575\n',
    );
  });

  it('creates the file when it does not exist', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'mc-')), 'server.properties');
    await writeProperties(file, { 'enable-rcon': 'true' });
    expect(readFileSync(file, 'utf8')).toBe('enable-rcon=true\n');
  });
});

describe('isLegacyJava', () => {
  it('uses the legacy command syntax before 1.21.5', () => {
    expect(isLegacyJava('1.20.4')).toBe(true);
    expect(isLegacyJava('1.21')).toBe(true);
    expect(isLegacyJava('1.21.4')).toBe(true);
    expect(isLegacyJava('1.21.5')).toBe(false);
    expect(isLegacyJava('26.3')).toBe(false);
  });
});
