import parkFields from "../capacity/nyc-park-fields.json";
import type { ParkField, Point } from "../capacity/nearby";
import { guessField } from "../permits/fees";
import { officeFor, PERMIT_OFFICES_PAGE } from "../permits/give-back";

const FIELDS = parkFields.fields as readonly ParkField[];

export type PermitOffice = { name: string; phone: string | null; page: string };

/**
 * The borough permit office to phone when two groups hold the same time on a
 * field, from NYC Parks' own list in the permits domain. The borough comes
 * from the nearest NYC Parks field to the venue; a venue Parks' data doesn't
 * place gets the page that lists every office, and no phone number.
 */
export function permitOfficeFor(
  venue: Point | null,
  fieldName: string,
): PermitOffice {
  const guess = guessField(FIELDS, venue, fieldName);
  const office = officeFor(guess.borough, guess.park);
  return office
    ? { ...office, page: PERMIT_OFFICES_PAGE }
    : {
        name: "NYC Parks permit office",
        phone: null,
        page: PERMIT_OFFICES_PAGE,
      };
}
