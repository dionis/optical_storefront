import type { MedusaContainer } from "@medusajs/framework/types";
import { recordAudit } from "./audit";
import { sellerOfUser } from "./seller-link";
import { sellerService, type Seller } from "./sellers";
import { profileOf, saveProfile } from "./staff-profile-data";

/**
 * A person who sells at the counter has one address, kept in two places: their
 * staff profile and their seller record. Saving in either updates both, unless
 * the two already say different things: then it is not ours to pick, and the
 * person decides (owner's decision). They may also keep two on purpose
 * (`address_separate`), which is remembered so nobody is asked again.
 */

export const ADDRESS_CHOICES = ["this", "other", "separate"] as const;
export type AddressChoice = (typeof ADDRESS_CHOICES)[number];

const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export const isAddressChoice = (v: unknown): v is AddressChoice => (ADDRESS_CHOICES as readonly unknown[]).includes(v);

export interface AddressSave {
  /** This place, the one being saved. */
  own: string | null;
  other: string | null;
  separate: boolean;
  conflict: boolean;
}

/**
 * What each place holds after saving `next` here. `next` undefined = this place's
 * value was not edited, only a choice was made. Pure.
 */
export function resolveAddressSave(input: {
  own: string | null;
  other: string | null;
  separate: boolean;
  next: string | null | undefined;
  choice?: AddressChoice | null;
}): AddressSave {
  // While it is one address, an empty place simply has not been told yet.
  const own = input.separate ? input.own : input.own || input.other;
  const other = input.separate ? input.other : input.other || input.own;
  const next = input.next === undefined ? own : input.next || null;

  if (input.choice === "this") return { own: next, other: next, separate: false, conflict: false };
  if (input.choice === "other") return { own: other, other, separate: false, conflict: false };
  if (input.choice === "separate") return { own: next, other, separate: true, conflict: false };

  if (input.separate) return { own: next, other, separate: true, conflict: false };
  // Nothing edited here: saving something else in the form never asks about this.
  if (same(next, own)) return { own, other, separate: false, conflict: false };
  // They were one address, or the new value settles it.
  if (same(own, other) || same(next, other)) return { own: next, other: next, separate: false, conflict: false };
  return { own, other, separate: false, conflict: true };
}

export type AddressState = "single" | "conflict" | "separate";

export interface AddressLink {
  state: AddressState;
  /** What to show in this place's field. */
  address: string | null;
  /** The other place's address, when it is a different one; null otherwise. */
  other: string | null;
}

/** How the two places stand, for the panel. Pure. */
export function addressLink(own: string | null, other: string | null, separate: boolean): AddressLink {
  if (separate) return { state: "separate", address: own, other };
  if (own && other && !same(own, other)) return { state: "conflict", address: own, other };
  return { state: "single", address: own || other, other: null };
}

/** A seller as the panel sees it: the address shown is the person's, wherever it is kept. */
export async function sellerWithAddress(container: MedusaContainer, seller: Seller): Promise<Seller & { address_link: AddressLink | null }> {
  if (!seller.user_id) return { ...seller, address_link: null };
  const profile = await profileOf(container, seller.user_id);
  const link = addressLink(seller.address, profile.address, seller.address_separate);
  return { ...seller, address: link.address, address_link: link };
}

/** A profile's address as the panel sees it; null link when the person has no seller record. */
export async function profileAddressLink(container: MedusaContainer, userId: string, profileAddress: string | null): Promise<AddressLink | null> {
  const seller = await sellerOfUser(container, userId);
  return seller ? addressLink(profileAddress, seller.address, seller.address_separate) : null;
}

export type AddressOutcome = { conflict: true; other: string | null } | { conflict: false; address: string | null; separate: boolean };

/** Saving on the seller record: writes the profile's side now; the caller saves the record. */
export async function saveFromSeller(
  container: MedusaContainer,
  seller: Seller,
  next: string | null | undefined,
  choice: AddressChoice | null,
  actorId: string | null
): Promise<AddressOutcome> {
  if (!seller.user_id) return { conflict: false, address: next === undefined ? seller.address : next, separate: false };
  const profile = await profileOf(container, seller.user_id);
  const r = resolveAddressSave({ own: seller.address, other: profile.address, separate: seller.address_separate, next, choice });
  if (r.conflict) return { conflict: true, other: profile.address };
  if (!same(r.other, profile.address)) {
    await saveProfile(container, seller.user_id, { address: r.other }, actorId);
    await recordAudit(container, { actorId, action: "profile.change", entity: "staff_profile", entityId: seller.user_id, before: { address: profile.address }, after: { address: r.other } });
  }
  return { conflict: false, address: r.own, separate: r.separate };
}

/** Saving on the profile: writes the seller record's side now; the caller saves the profile. */
export async function saveFromProfile(
  container: MedusaContainer,
  userId: string,
  next: string | null | undefined,
  choice: AddressChoice | null,
  actorId: string | null
): Promise<AddressOutcome> {
  const profile = await profileOf(container, userId);
  const seller = await sellerOfUser(container, userId);
  if (!seller) return { conflict: false, address: next === undefined ? profile.address : next, separate: false };
  const r = resolveAddressSave({ own: profile.address, other: seller.address, separate: seller.address_separate, next, choice });
  if (r.conflict) return { conflict: true, other: seller.address };
  if (!same(r.other, seller.address) || r.separate !== seller.address_separate) {
    await sellerService(container).updateSellers([{ id: seller.id, address: r.other, address_separate: r.separate }]);
    await recordAudit(container, { actorId, action: "profile.change", entity: "seller", entityId: seller.id, before: { address: seller.address }, after: { address: r.other } });
  }
  return { conflict: false, address: r.own, separate: r.separate };
}
