// Pre-compress built assets so the server can send Brotli/gzip without doing work per request.
// The link from Malaysia to the server is slow, so every byte saved matters.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"

const root = process.argv[2] ?? "dist"
const exts = /\.(js|css|html|svg|json|txt|ics)$/

let before = 0
let after = 0
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (exts.test(name)) {
      const buf = readFileSync(p)
      if (buf.length < 1024) continue
      const br = brotliCompressSync(buf, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
      })
      writeFileSync(p + ".br", br)
      writeFileSync(p + ".gz", gzipSync(buf, { level: 9 }))
      before += buf.length
      after += br.length
    }
  }
}
walk(root)
console.log(`compressed: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB brotli`)
