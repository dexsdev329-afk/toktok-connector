import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from './database';
import { exportProfile, importProfile } from './profile-io';
import { createRepositories, type Repositories, type SecretCipher } from './repositories';

const fakeCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(s.split('').reverse().join(''), 'utf8'),
  decrypt: (b) => b.toString('utf8').split('').reverse().join(''),
};

let db: Db;
let repos: Repositories;

beforeEach(() => {
  db = openDatabase(':memory:');
  repos = createRepositories(db, fakeCipher);
});

describe('migrations', () => {
  it('is idempotent', () => {
    expect(migrate(db)).toBe(0);
  });
});

describe('settings & secrets', () => {
  it('stores JSON settings', () => {
    repos.settings.set('tiktok.username', 'abc');
    expect(repos.settings.get('tiktok.username', '')).toBe('abc');
    expect(repos.settings.get('missing', 42)).toBe(42);
  });

  it('never stores secrets in clear text', () => {
    repos.secrets.set('rcon:pwd', 'hunter2');
    const raw = db.prepare('SELECT cipher FROM secrets').get() as { cipher: Buffer };
    expect(raw.cipher.toString('utf8')).not.toContain('hunter2');
    expect(repos.secrets.get('rcon:pwd')).toBe('hunter2');
    repos.secrets.deletePrefix('rcon:');
    expect(repos.secrets.has('rcon:pwd')).toBe(false);
  });

  it('refuses to store secrets without secure storage', () => {
    const r = createRepositories(db, { ...fakeCipher, isAvailable: () => false });
    expect(() => r.secrets.set('k', 'v')).toThrow(/Stockage sécurisé/);
  });
});

describe('profiles & actions', () => {
  it('activates the first profile automatically and cascades deletes', () => {
    const p = repos.profiles.create({ name: 'Minecraft' });
    expect(repos.profiles.getActive()?.id).toBe(p.id);
    repos.actions.save({
      profileId: p.id,
      name: 'TNT',
      trigger: { kind: 'gift', giftId: '5655' },
      effects: [{ integrationId: 'mc', effectId: 'rcon.command', params: { command: 'say hi' } }],
    });
    expect(repos.actions.listByProfile(p.id)).toHaveLength(1);
    repos.profiles.delete(p.id);
    expect(repos.actions.count()).toBe(0);
  });

  it('rejects invalid actions', () => {
    const p = repos.profiles.create({ name: 'X' });
    expect(() =>
      repos.actions.save({
        profileId: p.id,
        name: 'bad',
        trigger: { kind: 'command', name: 'has space' },
        effects: [],
      }),
    ).toThrow();
  });

  it('round-trips export/import', () => {
    const p = repos.profiles.create({ name: 'Minecraft', game: 'minecraft' });
    repos.actions.save({
      profileId: p.id,
      name: 'Zombie',
      trigger: { kind: 'diamonds', min: 10 },
      effects: [{ integrationId: 'mc', effectId: 'rcon.command', params: { command: 'summon zombie' } }],
      quantityMode: 'multiply',
    });
    const exported = JSON.parse(JSON.stringify(exportProfile(repos.profiles, repos.actions, p.id)));
    const imported = importProfile(db, repos.profiles, repos.actions, exported);
    expect(imported.id).not.toBe(p.id);
    const acts = repos.actions.listByProfile(imported.id);
    expect(acts).toHaveLength(1);
    expect(acts[0]?.quantityMode).toBe('multiply');
    expect(() => importProfile(db, repos.profiles, repos.actions, { formatVersion: 99 })).toThrow();
  });
});

describe('sessions & stats', () => {
  it('aggregates top donors', () => {
    const s = repos.sessions.start('tiktok', 'me');
    const a = { id: '1', username: 'a', displayName: 'A' };
    const b = { id: '2', username: 'b', displayName: 'B' };
    repos.sessions.addViewerStats(s, a, { diamonds: 10, gifts: 1 });
    repos.sessions.addViewerStats(s, b, { diamonds: 5, gifts: 1 });
    repos.sessions.addViewerStats(s, b, { diamonds: 20, gifts: 1 });
    repos.sessions.addViewerStats(s, { id: '3', username: 'c', displayName: 'C' }, { likes: 3 });
    expect(repos.sessions.topDonors(s, 5).map((d) => [d.username, d.diamonds])).toEqual([
      ['b', 25],
      ['a', 10],
    ]);
  });

  it('prunes the event log', () => {
    for (let i = 0; i < 10; i++) repos.eventLog.append(null, 'x', { i }, 1000 + i);
    repos.eventLog.prune(1_000_000, 3, 1010);
    expect(repos.eventLog.recent(100)).toHaveLength(3);
  });
});
