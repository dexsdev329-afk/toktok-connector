#!/usr/bin/env node
/**
 * Fake Minecraft RCON server for testing actions without running Minecraft.
 * Prints every command it receives.
 *
 *   node scripts/fake-rcon-server.mjs [port=25575] [password=test]
 */
import net from 'node:net';

const port = Number(process.argv[2] ?? 25575);
const password = process.argv[3] ?? 'test';

function packet(id, type, text) {
  const body = Buffer.from(text, 'utf8');
  const out = Buffer.alloc(14 + body.length);
  out.writeInt32LE(10 + body.length, 0);
  out.writeInt32LE(id, 4);
  out.writeInt32LE(type, 8);
  body.copy(out, 12);
  return out;
}

net
  .createServer((sock) => {
    let buf = Buffer.alloc(0);
    let authed = false;
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (buf.length < len + 4) break;
        const id = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const body = buf.toString('utf8', 12, 4 + len - 2);
        buf = buf.subarray(len + 4);
        if (type === 3) {
          authed = body === password;
          console.log(authed ? '✓ authentifié' : '✗ mauvais mot de passe');
          sock.write(packet(authed ? id : -1, 2, ''));
        } else if (type === 2 && authed) {
          console.log(`> ${body}`);
          sock.write(packet(id, 0, body === 'list' ? 'There are 1 of a max of 20 players online: Test' : ''));
        }
      }
    });
    sock.on('error', () => undefined);
  })
  .listen(port, '127.0.0.1', () => console.log(`Faux serveur RCON sur 127.0.0.1:${port} (mot de passe : ${password})`));
