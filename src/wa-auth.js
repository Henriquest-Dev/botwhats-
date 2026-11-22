// Onde fica guardada a sessão do WhatsApp de cada número de bot.
//  - PgAuthStore:   no Supabase (recomendado). Se o servidor reiniciar ou mudares de
//                   servidor, o número continua ligado.
//  - FileAuthStore: em ficheiros (data/bots/<numero>/auth), compatível com o formato do Baileys.
import fs from 'node:fs';
import path from 'node:path';

export class FileAuthStore {
  constructor(baseDir) { this.baseDir = baseDir; }
  dir(phone) { return path.join(this.baseDir, phone, 'auth'); }
  file(phone, key) { return path.join(this.dir(phone), `${key}.json`); }
  async has(phone) { return fs.existsSync(this.file(phone, 'creds')); }
  async clear(phone) { fs.rmSync(this.dir(phone), { recursive: true, force: true }); }
  async readMany(phone, keys) {
    const out = new Map();
    for (const k of keys) {
      try { out.set(k, fs.readFileSync(this.file(phone, k), 'utf8')); } catch { /* não existe */ }
    }
    return out;
  }
  async writeMany(phone, entries) {
    fs.mkdirSync(this.dir(phone), { recursive: true });
    for (const { key, value } of entries) {
      const f = this.file(phone, key);
      if (value == null) fs.rmSync(f, { force: true });
      else { fs.writeFileSync(f + '.tmp', value); fs.renameSync(f + '.tmp', f); }
    }
  }
}

export class PgAuthStore {
  /** @param {import('pg').Pool} pool */
  constructor(pool) { this.pool = pool; }
  async has(phone) {
    const r = await this.pool.query("select 1 from wa_auth where bot_phone=$1 and key='creds'", [phone]);
    return r.rowCount > 0;
  }
  async clear(phone) { await this.pool.query('delete from wa_auth where bot_phone=$1', [phone]); }
  async readMany(phone, keys) {
    if (!keys.length) return new Map();
    const r = await this.pool.query('select key, value from wa_auth where bot_phone=$1 and key = any($2::text[])', [phone, keys]);
    return new Map(r.rows.map(x => [x.key, x.value]));
  }
  async writeMany(phone, entries) {
    const del = entries.filter(e => e.value == null).map(e => e.key);
    const up = entries.filter(e => e.value != null);
    if (del.length) await this.pool.query('delete from wa_auth where bot_phone=$1 and key = any($2::text[])', [phone, del]);
    if (up.length) {
      await this.pool.query(
        `insert into wa_auth (bot_phone, key, value)
         select $1, k, v from unnest($2::text[], $3::text[]) as t(k, v)
         on conflict (bot_phone, key) do update set value = excluded.value, updated_at = now()`,
        [phone, up.map(e => e.key), up.map(e => e.value)],
      );
    }
  }
}

/** Estado de autenticação do Baileys guardado num AuthStore (Supabase ou ficheiros). */
export async function useStoreAuthState(store, phone, { initAuthCreds, BufferJSON, proto }) {
  const ser = v => JSON.stringify(v, BufferJSON.replacer);
  const de = s => JSON.parse(s, BufferJSON.reviver);
  const keyOf = (type, id) => `${type}-${id}`.replace(/\//g, '__').replace(/:/g, '-');
  const raw = (await store.readMany(phone, ['creds'])).get('creds');
  const creds = raw && raw !== '{}' ? de(raw) : initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const found = await store.readMany(phone, ids.map(id => keyOf(type, id)));
          const out = {};
          for (const id of ids) {
            const s = found.get(keyOf(type, id));
            let v = s ? de(s) : null;
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }
          return out;
        },
        set: async data => {
          const entries = [];
          for (const type in data) for (const id in data[type]) {
            const v = data[type][id];
            entries.push({ key: keyOf(type, id), value: v ? ser(v) : null });
          }
          await store.writeMany(phone, entries);
        },
      },
    },
    saveCreds: () => store.writeMany(phone, [{ key: 'creds', value: ser(creds) }]),
  };
}
