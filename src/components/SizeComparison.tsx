// Stellt alle Gegenstände im selben Maßstab nebeneinander,
// zusammen mit einer 170 cm großen Person als Vergleich.
// So sieht man sofort, ob die eingegebenen Maße zueinander passen.
import type { Item } from '../types'
import { useObjectUrl } from '../lib/useObjectUrl'

const PERSON_CM = 170
const ROW_PX = 170

function Thing({ item, scale, onOpen }: { item: Item; scale: number; onOpen: () => void }) {
  const url = useObjectUrl(item.image)
  return (
    <button
      className="cmp-thing"
      style={{ width: Math.max(8, item.widthCm * scale), height: Math.max(8, item.heightCm * scale) }}
      onClick={onOpen}
      aria-label={`${item.title}, ${item.widthCm} mal ${item.heightCm} Zentimeter`}
    >
      {url && <img src={url} alt="" />}
    </button>
  )
}

export function SizeComparison({ items, onOpen }: { items: Item[]; onOpen: (id: string) => void }) {
  const tallest = Math.max(PERSON_CM, ...items.map((i) => i.heightCm))
  const scale = ROW_PX / tallest
  const personH = PERSON_CM * scale

  return (
    <div className="cmp scroll" role="group" aria-label="Größenvergleich">
      <div className="cmp-row" style={{ height: ROW_PX }}>
        <svg className="cmp-person" width={personH * 0.3} height={personH} viewBox="0 0 30 100" aria-label="Person, 170 cm">
          <circle cx="15" cy="7" r="6.5" />
          <path d="M6 17h18a3 3 0 0 1 3 3v28a3 3 0 0 1-6 0V30h-1v66a4 4 0 0 1-8 0V58h-2v38a4 4 0 0 1-8 0V30H9v18a3 3 0 0 1-6 0V20a3 3 0 0 1 3-3z" />
        </svg>
        {items.map((item) => (
          <Thing key={item.id} item={item} scale={scale} onOpen={() => onOpen(item.id)} />
        ))}
      </div>
      <div className="cmp-floor" />
    </div>
  )
}
