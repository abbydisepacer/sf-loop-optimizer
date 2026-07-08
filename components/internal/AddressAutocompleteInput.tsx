"use client";

import { useEffect, useRef, useState } from "react";
import { loadPlacesLibrary } from "@/lib/google-maps-loader";

export type PlaceSelection = {
  address: string;
  lat: number;
  lng: number;
  /** The place's business name, when the selected result is a named establishment. */
  name?: string;
};

type Suggestion = {
  key: string;
  prediction: google.maps.places.PlacePrediction;
  mainText: string;
  secondaryText: string | null;
};

const DEBOUNCE_MS = 250;

/**
 * A plain <input> styled like the rest of the form, backed by the Places
 * API (New) AutocompleteSuggestion data service — not Google's
 * <gmp-place-autocomplete> widget, which renders inside a closed shadow
 * root and can't be restyled to match. We own the dropdown UI instead.
 */
export default function AddressAutocompleteInput({
  value,
  onChange,
  onPlaceSelected,
  placeholder,
  className,
}: {
  value: string;
  onChange: (address: string) => void;
  onPlaceSelected: (place: PlaceSelection) => void;
  placeholder?: string;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [unavailable, setUnavailable] = useState(false);

  const placesRef = useRef<google.maps.PlacesLibrary | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPlacesLibrary()
      .then((places) => {
        placesRef.current = places;
      })
      .catch((err) => {
        console.error("Google Places Autocomplete unavailable:", err);
        setUnavailable(true);
      });
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = (input: string) => {
    const places = placesRef.current;
    if (!places || !input.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new places.AutocompleteSessionToken();
    }
    places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input,
      sessionToken: sessionTokenRef.current,
    })
      .then(({ suggestions: results }) => {
        const mapped = results
          .map((s) => s.placePrediction)
          .filter((p): p is google.maps.places.PlacePrediction => p !== null)
          .map((prediction) => ({
            key: prediction.placeId,
            prediction,
            mainText: (prediction.mainText ?? prediction.text).text,
            secondaryText: prediction.secondaryText?.text ?? null,
          }));
        setSuggestions(mapped);
        setOpen(mapped.length > 0);
        setHighlighted(-1);
        setUnavailable(false);
      })
      .catch((err) => {
        console.error("Places autocomplete request failed:", err);
        setUnavailable(true);
      });
  };

  const handleInputChange = (text: string) => {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(text), DEBOUNCE_MS);
  };

  const selectSuggestion = async (suggestion: Suggestion) => {
    setOpen(false);
    setSuggestions([]);
    const place = suggestion.prediction.toPlace();
    await place.fetchFields({ fields: ["formattedAddress", "location"] });
    const lat = place.location?.lat();
    const lng = place.location?.lng();
    const address = place.formattedAddress ?? suggestion.mainText;
    onChange(address);
    if (lat !== undefined && lng !== undefined) {
      // Only named businesses ("establishment") have a real name to offer —
      // for a plain address, mainText is just the street, not a firm name.
      const isEstablishment = suggestion.prediction.types.includes("establishment");
      onPlaceSelected({ address, lat, lng, name: isEstablishment ? suggestion.mainText : undefined });
    }
    // A session concludes once fetchFields is called — start fresh next time.
    sessionTokenRef.current = null;
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
        selectSuggestion(suggestions[highlighted]);
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
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-controls="address-autocomplete-listbox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <ul
          id="address-autocomplete-listbox"
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li key={s.key} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectSuggestion(s)}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  i === highlighted ? "bg-slate-100" : "bg-white"
                }`}
              >
                <span className="font-semibold text-slate-800">{s.mainText}</span>
                {s.secondaryText && (
                  <span className="ml-1 text-slate-500">{s.secondaryText}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {unavailable && (
        <p className="mt-1 text-xs text-amber-600">
          Autocomplete unavailable right now — you can still type the full address manually.
        </p>
      )}
    </div>
  );
}
