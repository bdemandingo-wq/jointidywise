import { useState, useEffect } from "react";
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { Loader2, User, MapPin, Plus, Trash2, Check, Trophy, FileText, Download, Pencil } from "lucide-react";
import { toast } from "sonner";
import { matrixToCsv } from '@/lib/orgDataExport';
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClientPortal } from "@/contexts/ClientPortalContext";
import { useOrgTiers } from "@/hooks/useOrgTiers";
import { supabase } from "@/lib/supabase";
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { PERSON_NAME_MAX } from '@/lib/displayName';
import { fmt } from '@/lib/activeCurrency';

const ADDRESS_LABELS = ["Home", "Office", "Airbnb", "Rental", "Other"];

const LABEL_EMOJIS: Record<string, string> = {
  home: "🏠",
  office: "🏢",
  airbnb: "🏡",
  rental: "🔑",
  other: "📍",
  "primary address": "🏠",
};

function getLabelEmoji(label: string) {
  return LABEL_EMOJIS[label.toLowerCase()] || "📍";
}

interface Location {
  id: string;
  name: string;
  address: string;
  apt_suite: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  is_primary: boolean;
}

export function PortalProfileTab() {
  const { user, customer, loyalty, refreshData, invokePortal, contactsError, retryContacts } = useClientPortal();
  const [firstName, setFirstName] = useState(customer?.first_name || "");
  const [lastName, setLastName] = useState(customer?.last_name || "");
  const [phone, setPhone] = useState(customer?.phone || "");
  const [propertyType, setPropertyType] = useState(customer?.property_type || "residential");
  const [savingProfile, setSavingProfile] = useState(false);

  // Email-change REQUEST, deliberately not a self-serve edit.
  //
  // Email is the portal login credential — client-portal-login resolves identity
  // by it — so changing it rotates the credential rather than editing a display
  // field. Doing that safely needs verification of the new address, the old one
  // staying valid until confirmed, collision handling inside the org, and a
  // recovery path for someone who typos and locks themselves out. Instead the
  // customer asks, and an admin makes the change where they can see collisions
  // and confirm identity another way.
  const [showEmailRequest, setShowEmailRequest] = useState(false);
  const [requestedEmail, setRequestedEmail] = useState("");
  const [sendingEmailRequest, setSendingEmailRequest] = useState(false);
  
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocation, setNewLocation] = useState({
    name: "Home",
    address: "",
    apt_suite: "",
    city: "",
    state: "",
    zip_code: "",
    is_primary: false,
    latitude: null as number | null,
    longitude: null as number | null,
  });
  const [savingLocation, setSavingLocation] = useState(false);

  // Address CORRECTION, deliberately not a move.
  //
  // bookings stores BOTH a location_id and a copied snapshot of the address text,
  // so editing a locations row in place propagates through the id but not the
  // snapshot. That is right for a typo — the old text was never correct, and a
  // dispatcher looking up an old job should see the real street. It would be wrong
  // for a move, which rewrites where past cleans happened. A move is a separate
  // copy-on-write flow (new row, is_active=false on the old), deliberately not
  // built yet — so this must stay labelled as a correction and never become "Edit".
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [editLocation, setEditLocation] = useState({
    name: "", address: "", apt_suite: "", city: "", state: "", zip_code: "",
    latitude: null as number | null, longitude: null as number | null,
  });
  const [savingCorrection, setSavingCorrection] = useState(false);
  
  // Tiers come from the shared hook, not a local fetch. This component used to
  // run its own useState/useEffect copy of the same request; two independent
  // fetchers meant two caches and two places to keep the error handling right.
  const { tiers = [], isLoading: loadingTiers, error: tiersErrorObj } = useOrgTiers();
  const tiersError = tiersErrorObj?.message ?? null;

  useEffect(() => {
    if (customer) {
      setFirstName(customer.first_name);
      setLastName(customer.last_name);
      setPhone(customer.phone || "");
      setPropertyType(customer.property_type || "residential");
    }
  }, [customer]);

  useEffect(() => {
    if (!user) return;

    const fetchLocations = async () => {
      setLoadingLocations(true);
      const { data, error } = await invokePortal("client-portal-api", {
        body: { action: "get_locations" },
      });

      if (!error && data) {
        setLocations(data as Location[]);
      }
      setLoadingLocations(false);
    };

    fetchLocations();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- invokePortal is recreated each render; runs once when user is set
  }, [user]);

  const handleRequestEmailChange = async () => {
    const next = requestedEmail.trim().toLowerCase();
    const current = (customer?.email ?? "").trim().toLowerCase();

    // Format check is deliberately loose — the admin confirms the address before
    // acting on it, so rejecting an unusual-but-valid address here would be worse
    // than passing it along.
    if (!next || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (!current) {
      toast.error(
        contactsError
          ? `${contactsError} Tap "Try again" above, or contact us if it persists.`
          : "Still loading your details. One moment.",
      );
      return;
    }
    if (next === current) {
      toast.error("That's already your email address");
      return;
    }

    setSendingEmailRequest(true);
    try {
      const { data, error } = await invokePortal("client-portal-api", {
        body: { action: "request_email_change", p_new_email: next },
      });
      if (error) throw error;
      if (data && (data as { success?: boolean }).success === false) {
        throw new Error("Request was not accepted");
      }
      toast.success("Request sent. We'll be in touch to confirm the change.");
      setShowEmailRequest(false);
      setRequestedEmail("");
    } catch (err) {
      toast.error(await readEdgeFunctionError(err, "Couldn't send your request. Please try again."));
    } finally {
      setSendingEmailRequest(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user || !firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }

    // Never send a phone we did not load.
    //
    // saveSession() strips email and phone before persisting, so on a restored
    // session this input starts EMPTY even though the customer has a number.
    // Saving to fix a name typo then sent p_phone: null and destroyed it — and
    // phone is the channel every SMS uses (arrival, on-the-way, review request).
    //
    // An empty email is the reliable tell that contact details have not been
    // re-hydrated yet: email is the portal login identifier, so it is never
    // legitimately blank. Refuse rather than write, because
    // update_client_portal_profile does `phone = p_phone` UNCONDITIONALLY —
    // omitting the field would still null the column, so omission is not a fix
    // until that RPC uses COALESCE(p_phone, phone).
    const contactsHydrated = !!customer?.email;
    if (!contactsHydrated) {
      // Distinguish a failure from a load in progress. Telling someone to refresh
      // when the call is failing every time leaves them with no way out.
      toast.error(
        contactsError
          ? `${contactsError} Tap "Try again" above, or contact us if it persists.`
          : "Still loading your details. One moment.",
      );
      return;
    }

    setSavingProfile(true);

    try {
      const { data, error } = await invokePortal("client-portal-api", {
        body: {
          action: "update_profile",
          p_first_name: firstName.trim(),
          p_last_name: lastName.trim(),
          p_phone: phone.trim() || null,
        },
      });

      if (error) throw error;

      toast.success("Profile updated successfully!");
      await refreshData();
    } catch (err) {
      console.error("Profile update error:", err);
      toast.error("Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAddLocation = async () => {
    if (!user || !newLocation.name.trim() || !newLocation.address.trim()) {
      toast.error("Name and address are required");
      return;
    }

    setSavingLocation(true);

    try {
      const { data, error } = await invokePortal("client-portal-api", {
        body: {
          action: "add_location",
          p_name: newLocation.name.trim(),
          p_address: newLocation.address.trim(),
          p_apt_suite: newLocation.apt_suite.trim() || null,
          p_city: newLocation.city.trim() || null,
          p_state: newLocation.state.trim() || null,
          p_zip_code: newLocation.zip_code.trim() || null,
          p_latitude: newLocation.latitude,
          p_longitude: newLocation.longitude,
          p_is_primary: newLocation.is_primary,
        },
      });

      if (error) throw error;

      toast.success("Address added successfully!");
      setNewLocation({
        name: "Home",
        address: "",
        apt_suite: "",
        city: "",
        state: "",
        zip_code: "",
        is_primary: false,
        latitude: null,
        longitude: null,
      });
      setShowAddLocation(false);

      // Refresh locations
      const { data: updatedLocations } = await invokePortal("client-portal-api", {
        body: { action: "get_locations" },
      });
      if (updatedLocations) {
        setLocations(updatedLocations as Location[]);
      }
    } catch (err: any) {
      console.error("Add location error:", err);
      const msg = err?.context?.body?.error || err?.message || "Failed to add address";
      toast.error(msg);
    } finally {
      setSavingLocation(false);
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    if (!user) return;

    try {
      const { error } = await invokePortal("client-portal-api", {
        body: { action: "delete_location", locationId },
      });

      if (error) throw new Error(await readEdgeFunctionError(error, "Failed to delete address"));

      toast.success("Address deleted");
      setLocations((prev) => prev.filter((l) => l.id !== locationId));
    } catch (err) {
      console.error("Delete location error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to delete address");
    }
  };
  const startCorrection = (loc: Location) => {
    setEditLocation({
      name: loc.name ?? "",
      address: loc.address ?? "",
      apt_suite: (loc as { apt_suite?: string | null }).apt_suite ?? "",
      city: loc.city ?? "",
      state: loc.state ?? "",
      zip_code: loc.zip_code ?? "",
      latitude: null,
      longitude: null,
    });
    setEditingLocationId(loc.id);
  };

  const handleSaveCorrection = async () => {
    if (!editingLocationId) return;
    if (!editLocation.name.trim() || !editLocation.address.trim()) {
      toast.error("Label and street address are required");
      return;
    }
    setSavingCorrection(true);
    try {
      // Body keys are the DEPLOYED action's names, not the RPC's p_-prefixed
      // parameter names. The two are different languages and this call spoke the
      // wrong one: every field arrived as undefined, the RPC COALESCEd them all,
      // and the UPDATE became a bare updated_at bump that still returned true —
      // so the portal said "Address corrected" and changed nothing.
      // `node scripts/verify-portal-proxy.mjs` catches exactly this; run it.
      const { error } = await invokePortal("client-portal-api", {
        body: {
          action: "update_location",
          locationId: editingLocationId,
          name: editLocation.name.trim(),
          address: editLocation.address.trim(),
          apt_suite: editLocation.apt_suite.trim() || null,
          city: editLocation.city.trim() || null,
          state: editLocation.state.trim() || null,
          zip_code: editLocation.zip_code.trim() || null,
          latitude: editLocation.latitude,
          longitude: editLocation.longitude,
        },
      });
      if (error) throw error;
      // Reflect locally rather than refetching — the list has no query to
      // invalidate, it is useState-backed.
      setLocations((prev) =>
        prev.map((l) => (l.id === editingLocationId
          ? { ...l,
              name: editLocation.name.trim(),
              address: editLocation.address.trim(),
              city: editLocation.city.trim() || null,
              state: editLocation.state.trim() || null,
              zip_code: editLocation.zip_code.trim() || null }
          : l)),
      );
      toast.success("Address corrected");
      setEditingLocationId(null);
    } catch (err) {
      toast.error(await readEdgeFunctionError(err, "Couldn't correct that address."));
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleSetDefault = async (locationId: string) => {
    if (!user) return;
    try {
      // Unset all, then set the chosen one
      const { error } = await supabase
        .from("locations")
        .update({ is_primary: false })
        .eq("customer_id", user.customer_id);
      if (error) throw error;

      const { error: error2 } = await supabase
        .from("locations")
        .update({ is_primary: true })
        .eq("id", locationId);
      if (error2) throw error2;

      setLocations((prev) =>
        prev.map((l) => ({ ...l, is_primary: l.id === locationId }))
      );
      toast.success("Default address updated");
    } catch {
      toast.error("Failed to update default address");
    }
  };

  // Tiers are keyed on lifetime SPEND in dollars (client_tier_settings.
  // min_spending), so the value compared against them must be spend — not
  // lifetime_points. Those were previously conflated here, which only looked
  // right because the award trigger happens to grant 1 point per dollar; it is
  // wrong for any customer whose history was imported (their points are 0 while
  // their spend is real).
  const currentSpend = loyalty?.lifetime_spend ?? 0;

  // No "bronze" fallback: tier is null when the customer is below this org's
  // lowest threshold, which is a real state. Defaulting would highlight a tier
  // they have not reached — and "bronze" is one org's tier name, not a universal.
  const currentTierName = loyalty?.tier?.toLowerCase() ?? null;

  return (
    <div className="space-y-4 mt-4">
      {/* Profile Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <CardTitle>My Profile</CardTitle>
          </div>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first-name">First Name</Label>
              <Input
                id="first-name"
                value={firstName}
                maxLength={PERSON_NAME_MAX}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last-name">Last Name</Label>
              <Input
                id="last-name"
                value={lastName}
                maxLength={PERSON_NAME_MAX}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          {contactsError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <p className="text-sm text-destructive">{contactsError}</p>
              <p className="text-xs text-muted-foreground">
                Your email and phone can't be shown right now, so profile changes are
                paused to avoid overwriting them with blanks.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={retryContacts}>
                Try again
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={customer?.email || ""} disabled />
            {!showEmailRequest ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  This is also your sign-in address.
                </p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => setShowEmailRequest(true)}
                  disabled={!customer?.email}
                >
                  Request email change
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <Label htmlFor="requested-email" className="text-xs">
                  New email address
                </Label>
                <Input
                  id="requested-email"
                  type="email"
                  autoComplete="email"
                  value={requestedEmail}
                  onChange={(e) => setRequestedEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={sendingEmailRequest}
                />
                <p className="text-xs text-muted-foreground">
                  Because this address signs you in, we confirm the change with you
                  before it takes effect. Keep using your current address until then.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleRequestEmailChange}
                    disabled={sendingEmailRequest || !requestedEmail.trim()}
                  >
                    {sendingEmailRequest && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                    Send request
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowEmailRequest(false); setRequestedEmail(""); }}
                    disabled={sendingEmailRequest}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="property-type">Property Type</Label>
            <Select value={propertyType} onValueChange={setPropertyType}>
              <SelectTrigger id="property-type">
                <SelectValue placeholder="Select property type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="residential">Residential</SelectItem>
                <SelectItem value="airbnb">Airbnb / Vacation Rental</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              This helps us tailor our services to your property
            </p>
          </div>

          <Button onClick={handleSaveProfile} disabled={savingProfile} className="w-full">
            {savingProfile ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            Save Profile
          </Button>
        </CardContent>
      </Card>

      {/* Addresses Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <CardTitle>My Addresses</CardTitle>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddLocation(!showAddLocation)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
          <CardDescription>Manage your service locations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAddLocation && (
            <Card className="border-dashed">
              <CardContent className="pt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Label *</Label>
                    <Select value={newLocation.name || "Home"} onValueChange={(v) => setNewLocation({ ...newLocation, name: v })}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ADDRESS_LABELS.map(l => (
                          <SelectItem key={l} value={l}>{getLabelEmoji(l)} {l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Apt/Suite</Label>
                    <Input
                      placeholder="Apt 4B"
                      value={newLocation.apt_suite}
                      onChange={(e) =>
                        setNewLocation({ ...newLocation, apt_suite: e.target.value })
                      }
                      className="h-9"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Street Address *</Label>
                  <AddressAutocomplete
                    value={newLocation.address}
                    onChange={(v) => setNewLocation({ ...newLocation, address: v })}
                    onResolved={(r) =>
                      setNewLocation((prev) => ({
                        ...prev,
                        city: r.city || prev.city,
                        state: r.state || prev.state,
                        zip_code: r.zip || prev.zip_code,
                        latitude: r.lat,
                        longitude: r.lng,
                      }))
                    }
                    placeholder="123 Main St"
                    inputClassName="h-9"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">City</Label>
                    <Input
                      placeholder="City"
                      value={newLocation.city}
                      onChange={(e) =>
                        setNewLocation({ ...newLocation, city: e.target.value })
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">State</Label>
                    <Input
                      placeholder="FL"
                      value={newLocation.state}
                      onChange={(e) =>
                        setNewLocation({ ...newLocation, state: e.target.value })
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ZIP</Label>
                    <Input
                      placeholder="12345"
                      value={newLocation.zip_code}
                      onChange={(e) =>
                        setNewLocation({ ...newLocation, zip_code: e.target.value })
                      }
                      className="h-9"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Checkbox
                    id="set-default"
                    checked={newLocation.is_primary}
                    onCheckedChange={(checked) =>
                      setNewLocation({ ...newLocation, is_primary: !!checked })
                    }
                  />
                  <Label htmlFor="set-default" className="text-xs cursor-pointer">Set as default address</Label>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleAddLocation}
                    disabled={savingLocation}
                    size="sm"
                  >
                    {savingLocation && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    Save Address
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddLocation(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {loadingLocations ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : locations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No addresses saved yet. Add your first address to speed up booking requests.
            </p>
          ) : (
            <div className="space-y-3">
              {locations.map((location) => (
                <div
                  key={location.id}
                  className="flex items-start justify-between p-3 rounded-lg border"
                >
                  {editingLocationId === location.id ? (
                    <div className="flex-1 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Fixing a spelling mistake? Use this. Moved house? Add your
                        new address instead — correcting this one also updates it on
                        past bookings.
                      </p>
                      <Input
                        value={editLocation.name}
                        onChange={(e) => setEditLocation({ ...editLocation, name: e.target.value })}
                        placeholder="Label (Home, Office…)"
                        disabled={savingCorrection}
                      />
                      <AddressAutocomplete
                        value={editLocation.address}
                        onChange={(v) => setEditLocation({ ...editLocation, address: v })}
                        onResolved={(r) =>
                          setEditLocation((prev) => ({
                            ...prev,
                            city: r.city || prev.city,
                            state: r.state || prev.state,
                            zip_code: r.zip || prev.zip_code,
                            latitude: r.lat,
                            longitude: r.lng,
                          }))
                        }
                        placeholder="Street address"
                        disabled={savingCorrection}
                      />
                      <Input
                        value={editLocation.apt_suite}
                        onChange={(e) => setEditLocation({ ...editLocation, apt_suite: e.target.value })}
                        placeholder="Apt / suite (optional)"
                        disabled={savingCorrection}
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          value={editLocation.city}
                          onChange={(e) => setEditLocation({ ...editLocation, city: e.target.value })}
                          placeholder="City"
                          disabled={savingCorrection}
                        />
                        <Input
                          value={editLocation.state}
                          onChange={(e) => setEditLocation({ ...editLocation, state: e.target.value })}
                          placeholder="State"
                          disabled={savingCorrection}
                        />
                        <Input
                          value={editLocation.zip_code}
                          onChange={(e) => setEditLocation({ ...editLocation, zip_code: e.target.value })}
                          placeholder="ZIP"
                          disabled={savingCorrection}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveCorrection} disabled={savingCorrection}>
                          {savingCorrection && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                          Save correction
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingLocationId(null)}
                          disabled={savingCorrection}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                  <div className="flex gap-3">
                    <span className="text-xl mt-0.5">{getLabelEmoji(location.name)}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{location.name}</span>
                        {location.is_primary && (
                          <Badge variant="secondary" className="text-xs">
                            Default
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {location.address}
                        {location.apt_suite && `, ${location.apt_suite}`}
                      </p>
                      {(location.city || location.state || location.zip_code) && (
                        <p className="text-sm text-muted-foreground">
                          {[location.city, location.state, location.zip_code]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      )}
                      {!location.is_primary && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs text-primary"
                          onClick={() => handleSetDefault(location.id)}
                        >
                          Set as default
                        </Button>
                      )}
                    </div>
                  </div>
                  )}
                  {editingLocationId !== location.id && (
                  <div className="flex items-start gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      onClick={() => startCorrection(location)}
                      title="Correct this address"
                      aria-label="Correct this address"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteLocation(location.id)}
                      title="Remove this address"
                      aria-label="Remove this address"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loyalty Tiers Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <CardTitle>Loyalty Tiers</CardTitle>
          </div>
          <CardDescription>
            Your progress: {fmt(currentSpend)} lifetime spend
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingTiers ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tiersError ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {tiersError} Your points are still being tracked.
            </p>
          ) : tiers.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              This business hasn't set up loyalty tiers yet.
            </p>
          ) : (
            <div className="space-y-3">
              {tiers.map((tier, index) => {
                const isCurrentTier =
                  tier.tier_name.toLowerCase() === currentTierName;
                const isAchieved = currentSpend >= tier.min_spending;
                const progressToNext =
                  tier.max_spending !== null && currentSpend >= tier.min_spending
                    ? Math.min(
                        ((currentSpend - tier.min_spending) /
                          (tier.max_spending - tier.min_spending)) *
                          100,
                        100
                      )
                    : tier.max_spending === null && currentSpend >= tier.min_spending
                    ? 100
                    : (currentSpend / tier.min_spending) * 100;

                return (
                  <div
                    key={tier.tier_name}
                    className={`p-3 rounded-lg border transition-colors ${
                      isCurrentTier
                        ? "border-primary bg-primary/5"
                        : isAchieved
                        ? "bg-muted/30"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: tier.color }}
                        />
                        <span className="font-medium">{tier.tier_name}</span>
                        {isCurrentTier && (
                          <Badge variant="default" className="text-xs">
                            Current
                          </Badge>
                        )}
                        {isAchieved && !isCurrentTier && (
                          <Check className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {fmt(tier.min_spending)}
                        {tier.max_spending ? ` - ${fmt(tier.max_spending)}` : "+"}
                      </span>
                    </div>

                    {isCurrentTier && tier.max_spending && (
                      <div className="mb-2">
                        <Progress value={progressToNext} className="h-2" />
                        <p className="text-xs text-muted-foreground mt-1">
                          {fmt(tier.max_spending - currentSpend)} to next tier
                        </p>
                      </div>
                    )}

                    {tier.benefits && tier.benefits.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {tier.benefits.map((benefit, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {benefit}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tax Report Download Card */}
      <TaxReportCard clientUserId={user?.id} />
    </div>
  );
}

// Tax Report Component
function TaxReportCard({ clientUserId }: { clientUserId?: string }) {
  const { invokePortal } = useClientPortal();
  /* eslint-disable-next-line local/no-device-local-dates -- year label for a statement selector */
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [downloading, setDownloading] = useState(false);

  const years = Array.from({ length: 5 }, (_, i) => (currentYear - i).toString());

  const handleDownload = async () => {
    if (!clientUserId) {
      toast.error("Unable to download report");
      return;
    }

    setDownloading(true);

    try {
      const { data, error } = await invokePortal("client-portal-api", {
        body: { action: "get_tax_report", p_year: parseInt(selectedYear) },
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        toast.info("No completed bookings found for this year");
        return;
      }

      // Generate CSV content
      const headers = ["Date", "Service", "Address", "Subtotal", "Tax", "Total", "Payment Status"];
      const rows = data.map((row: any) => [
        // booking_date is a stored calendar date, rendered as-is.
        /* eslint-disable-next-line local/no-device-local-dates -- date string -> display */
        format(new Date(row.booking_date), "MM/dd/yyyy"),
        row.service_name,
        row.address || "",
        `${fmt(Number(row.subtotal))}`,
        `${fmt(Number(row.tax_amount))}`,
        `${fmt(Number(row.total_amount))}`,
        row.payment_status,
      ]);

      // Calculate totals
      const totalSubtotal = data.reduce((sum: number, r: any) => sum + Number(r.subtotal), 0);
      const totalTax = data.reduce((sum: number, r: any) => sum + Number(r.tax_amount), 0);
      const totalAmount = data.reduce((sum: number, r: any) => sum + Number(r.total_amount), 0);

      rows.push(["", "", "TOTALS:", `${fmt(totalSubtotal)}`, `${fmt(totalTax)}`, `${fmt(totalAmount)}`, ""]);

      // Client-facing tax report. This quoted every cell but never doubled the
      // inner quotes, so a value containing " terminated its own field early —
      // worse than no escaping, because the output looked handled.
      const csvContent = matrixToCsv([headers, ...rows]);

      // Download file
      const { exportFile } = await import('@/lib/exportFile');
      await exportFile(`tax-report-${selectedYear}.csv`, csvContent, 'text/csv');

      toast.success("Tax report downloaded!");
    } catch (err) {
      console.error("Tax report error:", err);
      toast.error("Failed to download tax report");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <CardTitle>Tax Reports</CardTitle>
        </div>
        <CardDescription>
          Download a summary of your bookings for tax purposes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label>Year</Label>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger>
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleDownload} disabled={downloading}>
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download CSV
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Report includes all completed bookings with payment details for the selected year.
        </p>
      </CardContent>
    </Card>
  );
}
