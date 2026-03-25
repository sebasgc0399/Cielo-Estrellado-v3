const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Formats centavos COP (e.g. 500000) as display string (e.g. "$5.000") */
export function formatCOP(amountInCents: number): string {
  return copFormatter.format(amountInCents / 100)
}
