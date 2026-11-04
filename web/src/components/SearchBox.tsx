import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type Option = { key: string; label: string; detail?: string; group?: string; swatch?: string };

/**
 * Type-to-search box (ARIA combobox). Arrow keys move, Enter picks, Escape closes.
 * `search(query)` returns the options to show; when the box isn't being edited
 * it shows `value` (the current choice).
 */
export default function SearchBox({
  label, value, placeholder, search, onPick, empty = "No matches. Try fewer letters.", hint, inputRef, autoSelectFirst = true,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  search: (q: string) => Option[];
  onPick: (o: Option) => void;
  empty?: string;
  hint?: ReactNode;
  inputRef?: React.RefObject<HTMLInputElement>;
  autoSelectFirst?: boolean;
}) {
  const id = useId();
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const [query, setQuery] = useState<string | null>(null); // null = not editing
  const [active, setActive] = useState(0);
  const open = query !== null;
  const options = open ? search(query) : [];

  useEffect(() => setActive(autoSelectFirst ? 0 : -1), [query, autoSelectFirst]);

  const pick = (o: Option) => {
    onPick(o);
    setQuery(null);
    ref.current?.blur();
  };

  let lastGroup: string | undefined;
  return (
    <div className="searchbox">
      <label htmlFor={id} className="searchbox-label">{label}</label>
      <input
        id={id}
        ref={ref}
        type="search"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && active >= 0 && options[active] ? `${id}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={open ? query : value ?? ""}
        onFocus={() => setQuery("")}
        onBlur={() => setQuery(null)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && options[active]) { e.preventDefault(); pick(options[active]); }
          else if (e.key === "Escape") { setQuery(null); ref.current?.blur(); }
        }}
      />
      {open && (query.trim() || options.length > 0) && (
        <ul id={`${id}-list`} role="listbox" className="searchbox-list">
          {options.length === 0 && <li className="searchbox-empty">{empty}</li>}
          {options.map((o, i) => {
            const header = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li key={o.key} role="presentation">
                {header && <div className="searchbox-group">{header}</div>}
                <div
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`searchbox-option${i === active ? " active" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  onMouseEnter={() => setActive(i)}
                >
                  {o.swatch && <span className="team-bar" style={{ background: o.swatch }} />}
                  <span className="searchbox-main">{o.label}</span>
                  {o.detail && <span className="searchbox-detail">{o.detail}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hint && <p className="searchbox-hint">{hint}</p>}
    </div>
  );
}
