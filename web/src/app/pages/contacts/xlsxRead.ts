/**
 * Leitor mínimo de planilha Excel (.xlsx) para "Importar contatos": lê a primeira aba (texto, números e booleanos)
 * e devolve as linhas como o leitor de CSV. Sem dependências: ZIP pelo diretório central e "deflate" pelo
 * DecompressionStream do navegador. Fórmulas entram pelo último valor calculado salvo no arquivo.
 */
const MAX_ENTRY = 50 * 1024 * 1024

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const out = new Uint8Array(await new Response(stream).arrayBuffer())
  if (out.length > MAX_ENTRY) throw new Error('too_large')
  return out
}

async function unzip(bytes: Uint8Array): Promise<Map<string, () => Promise<string>>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('not_zip')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const files = new Map<string, () => Promise<string>>()
  const decoder = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('not_zip')
    const method = view.getUint16(offset + 10, true), size = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true), name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    files.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), raw = bytes.subarray(start, start + size)
      return decoder.decode(method === 0 ? raw : method === 8 ? await inflate(raw) : (() => { throw new Error('unsupported') })())
    })
    offset += 46 + nameLength + extra + comment
  }
  return files
}

const text = (xml: Element | null) => (xml?.textContent ?? '')
const columnIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

/** Linhas da primeira aba; células vazias viram "". */
export async function readXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(new Uint8Array(buffer))
  const parser = new DOMParser(), xml = async (name: string) => { const read = files.get(name); return read ? parser.parseFromString(await read(), 'application/xml') : null }
  const workbook = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels')
  const first = workbook?.getElementsByTagName('sheet')[0], relId = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const target = [...(rels?.getElementsByTagName('Relationship') ?? [])].find((r) => r.getAttribute('Id') === relId)?.getAttribute('Target')
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml'
  const sheet = await xml(sheetPath) ?? await xml('xl/worksheets/sheet1.xml')
  if (!sheet) throw new Error('no_sheet')
  const sharedDoc = await xml('xl/sharedStrings.xml')
  const shared = [...(sharedDoc?.getElementsByTagName('si') ?? [])].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''))
  const rows: string[][] = []
  for (const row of [...sheet.getElementsByTagName('row')]) {
    const cells: string[] = []
    let next = 0
    for (const c of [...row.getElementsByTagName('c')]) {
      const ref = c.getAttribute('r'), at = ref ? columnIndex(ref) : next
      const type = c.getAttribute('t'), v = text(c.getElementsByTagName('v')[0] ?? null)
      const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('') : type === 'b' ? (v === '1' ? 'Sim' : 'Não') : v
      while (cells.length < at) cells.push('')
      cells[at] = value
      next = at + 1
    }
    if (cells.some((v) => v.trim())) rows.push(cells)
  }
  const width = Math.max(0, ...rows.map((r) => r.length))
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')])
}
