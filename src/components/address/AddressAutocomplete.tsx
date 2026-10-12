/**
 * AddressAutocomplete – the one address input for the whole app.
 *
 * Wraps the address-autocomplete edge function (Google Places New v1).
 * Lifted verbatim out of the booking form's PropertyStep, which was the
 * only place in the product that had working autocomplete.
 *
 * onResolved fires when the user picks a suggestion and carries the full
 * structured result, including lat/lng. Those coordinates come straight
 * from Places and are already international — call sites that have
 * somewhere to store them should, because the alternative (the
 * geocode-address function) is hard-locked to the US.
 *
 * Not every call site can persist coordinates yet: customer_locations has
 * no lat/lng columns and PublicBookingPage submits through an edge
 * function. Those pass a no-op for the coordinate half of onResolved and
 * still get the autocomplete + structured city/state/zip fill.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export interface ResolvedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  /** ISO-3166-1 alpha-2. '' when Places doesn't return a country. */
  country: string;
  formattedAddress: string;
}

interface Suggestion {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
}

function readPortalSessionToken(): string | null {
  try {
    const raw = localStorage.getItem('client_portal_session');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionToken?: unknown };
    return typeof parsed?.sessionToken === 'string' && parsed.sessionToken ? parsed.sessionToken : null;
  } catch {
    return null;
  }
}

export interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires only on suggestion pick, never on free typing. */
  onResolved: (resolved: ResolvedAddress) => void;
  /**
   * Public booking page only. Anonymous autocomplete is rejected unless
   * this is a real organization slug. Signed-in callers can omit it.
   */
  bookingOrgSlug?: string;
  id?: string;
  placeholder?: string;
  /** Applied to the positioning wrapper. */
  className?: string;
  /** Applied to the <Input> itself. */
  inputClassName?: string;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
}

// Region filtering stays off until organizations.country_code is populated
// everywhere. Passing a wrong region silently hides valid addresses;
// passing none just widens the result set. See PropertyStep history.
const REGION_CODE: string | undefined = undefined;

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 220;

export function AddressAutocomplete({
  value,
  onChange,
  onResolved,
  bookingOrgSlug,
  id,
  placeholder = 'Start typing an address...',
  className,
  inputClassName,
  disabled,
  required,
  'aria-label': ariaLabel,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  /**
   * Set by the input's onChange and consumed by the search effect below.
   *
   * The effect keys on `value`, which the parent also writes: a saved address
   * hydrating on mount, a suggestion being picked, a form resetting. Every one
   * of those looks identical to typing from inside the effect, and every
   * `suggest` call is a billed Google Places request — the edge function is a
   * direct proxy to places.googleapis.com with no cache. So the trigger has to
   * be the change *source*, not the value, and typing is the only source that
   * runs through here.
   */
  const userTypedRef = useRef(false);
  const sessionTokenRef = useRef<string>(crypto.randomUUID());
  const debounceRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = value.trim();

    // Read and clear in one go. Consuming the flag is what makes a programmatic
    // value change safe: whatever set `value` after the last keystroke — the
    // parent, or pickSuggestion below — falls through without a request.
    const typed = userTypedRef.current;
    userTypedRef.current = false;

    if (!typed || q.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setShowSuggest(false);
      setLoadingSuggest(false);
      return;
    }

    // Show the spinner immediately on keystroke so it feels sticky and
    // connected to what the user is typing, not like a late-flickering overlay.
    setLoadingSuggest(true);
    setSuggestions([]);

    debounceRef.current = window.setTimeout(async () => {
      try {
        const portalToken = readPortalSessionToken();
        const { data, error } = await supabase.functions.invoke('address-autocomplete', {
          body: {
            action: 'suggest',
            input: q,
            sessionToken: sessionTokenRef.current,
            regionCode: REGION_CODE,
            bookingOrgSlug,
          },
          headers: portalToken ? { 'x-portal-session': portalToken } : undefined,
        });
        if (error) throw error;
        setSuggestions((data?.suggestions ?? []) as Suggestion[]);
        setShowSuggest(true);
      } catch (e) {
        console.error('address suggest failed', e);
        setSuggestions([]);
      } finally {
        setLoadingSuggest(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, bookingOrgSlug]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pickSuggestion = async (s: Suggestion) => {
    setShowSuggest(false);
    onChange(s.mainText || s.text);
    try {
      const portalToken = readPortalSessionToken();
      const { data, error } = await supabase.functions.invoke('address-autocomplete', {
        body: {
          action: 'details',
          placeId: s.placeId,
          sessionToken: sessionTokenRef.current,
          bookingOrgSlug,
        },
        headers: portalToken ? { 'x-portal-session': portalToken } : undefined,
      });
      if (error) throw error;
      if (data?.street) {
        onChange(data.street);
      }
      onResolved({
        street: data?.street ?? '',
        city: data?.city ?? '',
        state: data?.state ?? '',
        zip: data?.zip ?? '',
        lat: typeof data?.lat === 'number' ? data.lat : null,
        lng: typeof data?.lng === 'number' ? data.lng : null,
        country: typeof data?.country === 'string' ? data.country.toUpperCase() : '',
        formattedAddress: data?.formattedAddress ?? '',
      });
    } catch (e) {
      console.error('address details failed', e);
    } finally {
      // Rotate after a completed selection (Google billing best practice).
      sessionTokenRef.current = crypto.randomUUID();
    }
  };

  return (
    <div className={cn('relative', className)} ref={wrapperRef}>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            userTypedRef.current = true;
            onChange(e.target.value);
          }}
          onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
          required={required}
          aria-label={ariaLabel}
          className={cn('pr-9', inputClassName)}
        />
        {loadingSuggest && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {showSuggest && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-72 overflow-auto">
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickSuggestion(s)}
              className="w-full text-left px-3 py-2 hover:bg-accent/60 transition-colors flex flex-col"
            >
              <span className="text-sm font-medium">{s.mainText || s.text}</span>
              {s.secondaryText && (
                <span className="text-xs text-muted-foreground">{s.secondaryText}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
