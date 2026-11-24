/** Zeigt Zentimeter auf Deutsch an, also mit Komma statt Punkt. */
export function cm(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 1, useGrouping: false })
}

export function dims(w: number, h: number, d: number): string {
  return `${cm(w)} × ${cm(h)} × ${cm(d)} cm`
}
