import type { FormEventHandler } from 'react'
import { ChevronRight, Command } from 'lucide-react'

type FridayComposerProps = {
  value: string
  loading: boolean
  placeholder: string
  onChange: (value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
}

export default function FridayComposer({ value, loading, placeholder, onChange, onSubmit }: FridayComposerProps) {
  return <form className="v3-friday-composer" onSubmit={onSubmit}>
    <Command size={18}/>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={loading}
    />
    <button type="submit" aria-label="Send command" disabled={loading}>
      <ChevronRight size={18}/>
    </button>
  </form>
}
