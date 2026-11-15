/**
 * Injury reports (ADR 0064): an incident whose kind is "injury", with the
 * little a carrier asks for and no more. The fixed lists, the form's rules,
 * how long a report is kept and the insurance export are pure; the database
 * work is in src/db/queries/injury.ts.
 */

import { toCsv } from "@/domain/export/csv";
import { err, ok, type Result } from "../result";

export const BODY_AREAS = {
  head: "Head",
  face: "Face or teeth",
  neck: "Neck",
  shoulder: "Shoulder",
  arm: "Arm or elbow",
  hand: "Hand or wrist",
  chest: "Chest or ribs",
  back: "Back",
  hip: "Hip or groin",
  leg: "Thigh or lower leg",
  knee: "Knee",
  ankle_foot: "Ankle or foot",
  other: "Somewhere else",
} as const;
export type BodyArea = keyof typeof BODY_AREAS;
export const BODY_AREA_KEYS = Object.keys(BODY_AREAS) as BodyArea[];
export const isBodyArea = (value: string): value is BodyArea =>
  Object.hasOwn(BODY_AREAS, value);

export const CARE_LEVELS = {
  none: "No care was needed",
  first_aid: "First aid at the field",
  ems: "EMS or an ambulance",
} as const;
export type CareLevel = keyof typeof CARE_LEVELS;
export const CARE_KEYS = Object.keys(CARE_LEVELS) as CareLevel[];
export const isCareLevel = (value: string): value is CareLevel =>
  Object.hasOwn(CARE_LEVELS, value);

/** The most characters in what happened. Less than a conduct report. */
export const INJURY_TEXT_MAX = 1000;
/** The most witnesses named, so the record stays small. */
export const WITNESSES_MAX = 6;
/** Years an injury's details are kept after the report (ADR 0064). */
export const INJURY_RETENTION_YEARS = 3;
/** What stays in place of the text once the details are removed. */
export const REMOVED_TEXT = "The injury details were removed.";

/** The day an injury report's details are due to be removed. */
export function injuryRemovalDate(reportedAt: Date): Date {
  const due = new Date(reportedAt);
  due.setUTCFullYear(due.getUTCFullYear() + INJURY_RETENTION_YEARS);
  return due;
}

/** The newest report date whose details are already past the period. */
export function injuryCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - INJURY_RETENTION_YEARS);
  return cutoff;
}

export type NewInjury = {
  hurt: string;
  bodyArea: BodyArea;
  care: CareLevel;
  details: string;
  witnesses: string[];
};

export type InjuryFormError =
  | "no_one_hurt"
  | "unknown_person"
  | "bad_body_area"
  | "bad_care"
  | "no_details"
  | "details_too_long"
  | "too_many_witnesses";

/**
 * Reads the injury form. The person hurt and every witness must be one of
 * `choices` (the two teams' players); a repeat counts once and the person
 * hurt is never also a witness.
 */
export function parseInjuryForm(
  values: {
    hurt: string;
    bodyArea: string;
    care: string;
    details: string;
    witnesses: readonly string[];
  },
  choices: ReadonlySet<string>,
): Result<NewInjury, InjuryFormError> {
  const hurt = values.hurt.trim();
  if (hurt === "") return err("no_one_hurt");
  if (!choices.has(hurt)) return err("unknown_person");
  if (!isBodyArea(values.bodyArea)) return err("bad_body_area");
  if (!isCareLevel(values.care)) return err("bad_care");
  const details = values.details.trim();
  if (details.length === 0) return err("no_details");
  if (details.length > INJURY_TEXT_MAX) return err("details_too_long");
  const witnesses = [...new Set(values.witnesses)].filter((w) => w !== hurt);
  if (witnesses.some((w) => !choices.has(w))) return err("unknown_person");
  if (witnesses.length > WITNESSES_MAX) return err("too_many_witnesses");
  return ok({
    hurt,
    bodyArea: values.bodyArea,
    care: values.care,
    details,
    witnesses,
  });
}

/** The league's current insurance certificate, as the export shows it. */
export type CertificateFacts = {
  insurer: string;
  policyNumber: string | null;
  startsOn: string;
  expiresOn: string;
};

/**
 * The certificate to show for a game: the one in force on its day, else the
 * one that ran out last. Dates are "YYYY-MM-DD", so they compare as text.
 */
export function certificateFor(
  certificates: readonly CertificateFacts[],
  day: string,
): { certificate: CertificateFacts; covers: boolean } | null {
  const inForce = certificates
    .filter((c) => c.startsOn <= day && day <= c.expiresOn)
    .sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0];
  if (inForce) return { certificate: inForce, covers: true };
  const latest = [...certificates].sort((a, b) =>
    b.expiresOn.localeCompare(a.expiresOn),
  )[0];
  return latest ? { certificate: latest, covers: false } : null;
}

export type InjuryExport = {
  leagueName: string;
  reportedOn: string;
  gameDay: string | null;
  matchup: string;
  hurt: string | null;
  bodyArea: BodyArea;
  care: CareLevel;
  details: string;
  witnesses: readonly string[];
  followUp: readonly { on: string; body: string }[];
  insurance: { certificate: CertificateFacts; covers: boolean } | null;
};

type Line = { field: string; value: string };

/**
 * The insurance carrier's copy: one Field and Value line per fact, as a CSV
 * a spreadsheet opens. It shows the date the league's insurance certificate
 * runs to, and whether it was in force on the game's day.
 */
export function injuryExportCsv(report: InjuryExport): string {
  const cert = report.insurance;
  const lines: Line[] = [
    { field: "League", value: report.leagueName },
    { field: "Report filed", value: report.reportedOn },
    { field: "Game", value: report.matchup },
    { field: "Game day", value: report.gameDay ?? "" },
    {
      field: "Person hurt",
      value: report.hurt ?? "Removed with their account",
    },
    { field: "Body area", value: BODY_AREAS[report.bodyArea] },
    { field: "Care given", value: CARE_LEVELS[report.care] },
    { field: "What happened", value: report.details },
    { field: "Witnesses", value: report.witnesses.join("; ") },
    {
      field: "Follow-up notes",
      value: report.followUp.map((n) => `${n.on}: ${n.body}`).join("\n"),
    },
    ...(cert
      ? [
          { field: "Insurer", value: cert.certificate.insurer },
          {
            field: "Policy number",
            value: cert.certificate.policyNumber ?? "",
          },
          {
            field: "Insurance certificate valid from",
            value: cert.certificate.startsOn,
          },
          {
            field: "Insurance certificate expires",
            value: cert.certificate.expiresOn,
          },
          {
            field: "Certificate in force on the game day",
            value: cert.covers ? "yes" : "no",
          },
        ]
      : [
          {
            field: "Insurance certificate",
            value: "None on file",
          },
        ]),
  ];
  return toCsv<Line>(
    [
      { header: "Field", value: (l) => l.field },
      { header: "Value", value: (l) => l.value },
    ],
    lines,
  );
}
