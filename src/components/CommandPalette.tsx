import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Sparkles } from 'lucide-react'

export type PaletteItem = {
  id: string
  group: string
  label: string
  hint?: string
  run: () => void
}

type CommandPaletteProps = {
  open: boolean
  items: PaletteItem[]
  onAsk: (prompt: string) => void
  onClose: () => void
}

export default function CommandPalette({ open, items, onAsk, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setSelected(0)
    inputRef.current?.focus()
    return () => { opener?.focus() }
  }, [open])

  const results = useMemo(() => {
    const text = query.trim().toLowerCase()
    const matches = text ? items.filter((item) => `${item.label} ${item.hint ?? ''} ${item.group}`.toLowerCase().includes(text)) : items
    const ask: PaletteItem[] = query.trim() ? [{ id: 'ask-friday', group: 'FRIDAY', label: `Ask FRIDAY: ${query.trim()}`, run: () => onAsk(query.trim()) }] : []
    return [...matches, ...ask]
  }, [items, query, onAsk])

  useEffect(() => { setSelected(0) }, [query])

  if (!open) return null

  function choose(item: PaletteItem | undefined) {
    if (!item) return
    item.run()
    onClose()
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key === 'Tab') { event.preventDefault(); inputRef.current?.focus() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((index) => Math.min(index + 1, results.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((index) => Math.max(index - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(results[selected]) }
  }

  return <div className="v3-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="v3-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
      <label className="v3-palette-search"><Search size={16}/>
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Search or command"
          aria-expanded="true"
          aria-controls="v3-palette-results"
          aria-activedescendant={results[selected] ? `v3-palette-${results[selected].id}` : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to a workspace, service or incident, or ask FRIDAY…"
        />
        <kbd>Esc</kbd>
      </label>
      <ul id="v3-palette-results" role="listbox" aria-label="Results">
        {results.map((item, index) => <li
          key={item.id}
          id={`v3-palette-${item.id}`}
          role="option"
          aria-selected={index === selected}
          className={index === selected ? 'selected' : ''}
          onMouseEnter={() => setSelected(index)}
          onClick={() => choose(item)}
        >
          {item.id === 'ask-friday' ? <Sparkles size={14}/> : <span className="v3-palette-group">{item.group}</span>}
          <b>{item.label}</b>
          {item.hint && <small>{item.hint}</small>}
        </li>)}
        {!results.length && <li className="v3-palette-empty" role="presentation">No matches</li>}
      </ul>
    </div>
  </div>
}
