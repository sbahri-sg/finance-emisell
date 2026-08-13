export function parseMoneyInput(value: string, decimalScale: 0 | 2) {
  const clean = value.replace(/[^\d.,]/g, '')
  if (!clean) return ''
  if (decimalScale === 0) return clean.replace(/\D/g, '').replace(/^0+(?=\d)/, '')

  const commaIndex = clean.lastIndexOf(',')
  const dotIndex = clean.lastIndexOf('.')
  const decimalIndex = commaIndex >= 0
    ? commaIndex
    : dotIndex >= 0 && clean.length - dotIndex - 1 <= decimalScale
      ? dotIndex
      : -1
  const integerPart = (decimalIndex >= 0 ? clean.slice(0, decimalIndex) : clean)
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '') || '0'
  if (decimalIndex < 0) return integerPart
  const decimalPart = clean.slice(decimalIndex + 1).replace(/\D/g, '').slice(0, decimalScale)
  return `${integerPart}.${decimalPart}`
}

export function formatMoneyInput(value: string, decimalScale: 0 | 2) {
  if (!value) return ''
  const [integerPart, decimalPart] = value.split('.')
  const formattedInteger = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(integerPart || 0))
  if (decimalScale === 0 || decimalPart === undefined) return formattedInteger
  return `${formattedInteger},${decimalPart}`
}
