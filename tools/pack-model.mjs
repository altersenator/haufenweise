// Packt das Freistell-Modell in eine JSON-Datei (Base64).
// Grund: Manche Hosting-Dienste liefern .onnx-Dateien nicht aus, JSON dagegen überall.
// Aufruf: node tools/pack-model.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const bytes = readFileSync(new URL('./u2netp.onnx', import.meta.url))
const sha256 = createHash('sha256').update(bytes).digest('hex')
mkdirSync(new URL('../public/models/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('../public/models/u2netp.json', import.meta.url),
  JSON.stringify({ name: 'u2netp', license: 'Apache-2.0', sha256, base64: bytes.toString('base64') }),
)
console.log('geschrieben: public/models/u2netp.json', bytes.length, 'Bytes', sha256)
