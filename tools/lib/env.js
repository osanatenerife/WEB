// Carga booking-api/.env.local en process.env (sin pisar lo que ya venga
// del terminal). Solo .env.local: las herramientas de prueba nunca leen
// el .env de producción.
const fs = require('fs');
const path = require('path');

const ENV_LOCAL = path.join(__dirname, '..', '..', 'booking-api', '.env.local');

function loadEnvLocal() {
  if (!fs.existsSync(ENV_LOCAL)) return false;
  for (const line of fs.readFileSync(ENV_LOCAL, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return true;
}

module.exports = { loadEnvLocal, ENV_LOCAL };
