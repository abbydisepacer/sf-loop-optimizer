"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountSearchResult } from "@/lib/salesforce/accounts";

const DEBOUNCE_MS = 300;

export default function FirmNameAutocompleteInput({
  value,
  onChange,
  onAccountSelected,
  placeholder,
  className,
}: {
  value: string;
  onChange: (name: string) => void;
  onAccountSelected: (account: AccountSearchResult) => void;
  placeholder?: string;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<AccountSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [unavailable, setUnavailable] = useState(false);
  const [searching, setSearching] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // A pasted phone number is already complete — no reason to wait out the
  // debounce meant for someone still typing character by character.
  const justPastedRef = useRef(false);
  // Guards against a slower, older request's response overwriting a newer
  // one's results if two searches are in flight at once.
  const requestIdRef = useRef(0);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = (query: string) => {
    if (!query.trim()) {
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setSearching(true);
    fetch(`/api/salesforce/accounts/search?q=${encodeURIComponent(query)}`)
      .then((res) => res.json())
      .then((data: { accounts?: AccountSearchResult[]; error?: string }) => {
        if (requestId !== requestIdRef.current) return; // a newer search superseded this one
        if (data.error) {
          setUnavailable(true);
          return;
        }
        const accounts = data.accounts ?? [];
        setSuggestions(accounts);
        setOpen(accounts.length > 0);
        setHighlighted(-1);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        console.error("Account search request failed:", err);
        setUnavailable(true);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setSearching(false);
      });
  };

  const handleInputChange = (text: string) => {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (justPastedRef.current) {
      justPastedRef.current = false;
      fetchSuggestions(text);
      return;
    }
    debounceRef.current = setTimeout(() => fetchSuggestions(text), DEBOUNCE_MS);
  };

  const handlePaste = () => {
    justPastedRef.current = true;
  };

  const selectAccount = (account: AccountSearchResult) => {
    setOpen(false);
    setSuggestions([]);
    onChange(account.name);
    onAccountSelected(account);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (highlighted >= 0) {
        e.preventDefault();
        selectAccount(suggestions[highlighted]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onPaste={handlePaste}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-controls="firm-name-autocomplete-listbox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {searching && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"
        >
          Searching…
        </span>
      )}
      {open && (
        <ul
          id="firm-name-autocomplete-listbox"
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg"
        >
          {suggestions.map((a, i) => (
            <li key={a.id} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectAccount(a)}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  i === highlighted ? "bg-slate-100" : "bg-white"
                }`}
              >
                <span className="font-semibold text-slate-800">{a.name}</span>
                {a.address.city && (
                  <span className="ml-1 text-slate-500">
                    {a.address.city}, {a.address.state}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {unavailable && (
        <p className="mt-1 text-xs text-amber-600">
          Account search unavailable right now — you can still type the firm name manually.
        </p>
      )}
    </div>
  );
}
