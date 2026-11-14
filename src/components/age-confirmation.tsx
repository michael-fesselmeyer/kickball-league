import { ageConfirmationLabel } from "@/domain/registration/age";

/**
 * The box registration and the waiver ask a player to tick: "I'm 21 or
 * older", with the season's minimum age (ADR 0041). The server checks it
 * again, against the birth date on the profile.
 */
export function AgeConfirmation({ minimumAge }: { minimumAge: number }) {
  return (
    <label className="flex min-h-11 items-center gap-2">
      <input
        type="checkbox"
        name="ageConfirmed"
        value="yes"
        required
        className="size-5 accent-brand"
      />
      {ageConfirmationLabel(minimumAge)}
    </label>
  );
}
