import { useEffect, useMemo, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { formatMoneyInput, parseMoneyInput } from '../lib/moneyInput'

type MoneyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'name' | 'value' | 'defaultValue' | 'onChange' | 'inputMode'
> & {
  name: string
  value?: number | string
  defaultValue?: number | string
  decimalScale?: 0 | 2
  onValueChange?: (value: number) => void
}

function normalizeValue(value: number | string | undefined) {
  if (value === undefined || value === '') return ''
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? String(number) : ''
}

export function MoneyInput({
  name,
  value,
  defaultValue,
  decimalScale = 0,
  onValueChange,
  placeholder = '0',
  ...props
}: MoneyInputProps) {
  const controlled = value !== undefined
  const externalValue = useMemo(() => normalizeValue(value), [value])
  const [internalValue, setInternalValue] = useState(() => normalizeValue(defaultValue))
  const rawValue = controlled ? externalValue : internalValue

  useEffect(() => {
    if (!controlled) setInternalValue(normalizeValue(defaultValue))
  }, [controlled, defaultValue])

  return (
    <>
      <input
        {...props}
        type="text"
        inputMode={decimalScale === 0 ? 'numeric' : 'decimal'}
        value={formatMoneyInput(rawValue, decimalScale)}
        placeholder={placeholder}
        onChange={(event) => {
          const next = parseMoneyInput(event.target.value, decimalScale)
          if (!controlled) setInternalValue(next)
          onValueChange?.(next === '' || next.endsWith('.') ? Number(next.slice(0, -1) || 0) : Number(next))
        }}
      />
      <input type="hidden" name={name} value={rawValue} disabled={props.disabled} />
    </>
  )
}
