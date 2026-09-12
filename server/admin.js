// Run locally over SSH as an administrator. No password is accepted in argv.
import { createAccountStore } from './account-store.js';
const [operation, username] = process.argv.slice(2);
if (operation !== 'reset-password' || !username || !process.stdin.isTTY) {
  console.error('Auf dem Server ausführen: node server/admin.js reset-password BENUTZERNAME');
  process.exit(1);
}
async function hiddenPassword(label) {
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.removeListener('data', input); process.stdin.setRawMode(false); process.stdin.pause();
      process.stdout.write('\n'); error ? reject(error) : resolve(value);
    };
    const input = chunk => {
      for (const character of String(chunk)) {
        if (character === '\u0003') return finish(new Error('Abgebrochen.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ' && value.length < 128) value += character;
      }
    };
    process.stdin.setEncoding('utf8'); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', input);
  });
}
let store;
try {
  const password = await hiddenPassword('Neues Passwort (Eingabe unsichtbar): ');
  if (password !== await hiddenPassword('Passwort wiederholen: ')) throw new Error('Passwörter stimmen nicht überein.');
  store = createAccountStore({ path: process.env.DATA_PATH ?? '/var/lib/dead-frequency/accounts.sqlite' });
  const result = await store.resetPassword(username, password);
  console.log(`Passwort für ${result.username} geändert; ${result.revokedSessions} Anmeldungen widerrufen.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store?.close(); }
