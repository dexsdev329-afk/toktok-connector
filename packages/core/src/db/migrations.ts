/**
 * Ordered schema migrations. Never edit a released migration: add a new one.
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE secrets (
        key    TEXT PRIMARY KEY,
        cipher BLOB NOT NULL
      );

      CREATE TABLE profiles (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        game       TEXT NOT NULL DEFAULT '',
        is_active  INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE actions (
        id               TEXT PRIMARY KEY,
        profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name             TEXT NOT NULL,
        enabled          INTEGER NOT NULL DEFAULT 1,
        position         INTEGER NOT NULL DEFAULT 0,
        trigger_json     TEXT NOT NULL,
        effects_json     TEXT NOT NULL,
        cooldown_ms      INTEGER NOT NULL DEFAULT 0,
        user_cooldown_ms INTEGER NOT NULL DEFAULT 0,
        priority         INTEGER NOT NULL DEFAULT 5,
        busy_policy      TEXT NOT NULL DEFAULT 'queue' CHECK (busy_policy IN ('queue', 'skip')),
        quantity_mode    TEXT NOT NULL DEFAULT 'once' CHECK (quantity_mode IN ('once', 'multiply')),
        max_multiplier   INTEGER NOT NULL DEFAULT 10,
        user_filter_json TEXT NOT NULL DEFAULT '{}',
        sound_id         TEXT,
        tts_template     TEXT,
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL
      );
      CREATE INDEX idx_actions_profile ON actions(profile_id, position);

      CREATE TABLE integrations (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        name        TEXT NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE gift_catalog (
        platform   TEXT NOT NULL,
        gift_id    TEXT NOT NULL,
        name       TEXT NOT NULL,
        diamonds   INTEGER NOT NULL,
        image_url  TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (platform, gift_id)
      );

      CREATE TABLE overlays (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        name        TEXT NOT NULL,
        style_json  TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '{}',
        token       TEXT NOT NULL
      );

      CREATE TABLE sounds (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        file_path TEXT NOT NULL,
        volume    REAL NOT NULL DEFAULT 1
      );

      CREATE TABLE live_sessions (
        id         TEXT PRIMARY KEY,
        platform   TEXT NOT NULL,
        channel    TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER
      );

      CREATE TABLE viewer_stats (
        session_id   TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        user_id      TEXT NOT NULL,
        username     TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_url   TEXT,
        diamonds     INTEGER NOT NULL DEFAULT 0,
        gifts        INTEGER NOT NULL DEFAULT 0,
        likes        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, user_id)
      );

      CREATE TABLE event_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   TEXT,
        ts           INTEGER NOT NULL,
        kind         TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX idx_event_log_ts ON event_log(ts);
    `,
  },
];
