import { db } from "@/db/client";
import { insuranceCertificates, requestSheetInputs } from "@/db/queries/books";
import {
  packetCounts,
  packetRosters,
  renewalInputs,
} from "@/db/queries/permit-packet";
import parkFields from "@/domain/capacity/nyc-park-fields.json";
import type { ParkField } from "@/domain/capacity/nearby";
import type { LeagueId, SeasonId } from "@/domain/ids";
import { localDate } from "@/domain/books/ledger-csv";
import {
  boroughAt,
  byBorough,
  type PacketInput,
} from "@/domain/permits/packet";
import { env } from "@/env";
import { siteOrigin } from "@/lib/site";
import { choicesQuery, requestChoices, requestSheetFor } from "../request";

type Query = Record<string, string | string[] | undefined>;

const FIELDS = parkFields.fields as readonly ParkField[];

/** Whether the owner asked for player names in the packet. */
export const wantsNames = (query: Query) => query.names === "1";

/**
 * Everything the packet screen and its download show, from the same query
 * string as the request sheet (so the packet carries the sheet the owner
 * worked out) plus `names=1` for the rosters with names.
 */
export async function loadPacket(
  league: { id: LeagueId; name: string; timeZone: string },
  season: {
    id: SeasonId;
    name: string;
    startsOn: string;
    endsOn: string;
    gamesPerTeamPerDay: number;
  },
  query: Query,
) {
  const names = wantsNames(query);
  const [inputs, held, counts, certificates, rosters] = await Promise.all([
    requestSheetInputs(db, league.id, season.id),
    renewalInputs(db, league.id, season.id),
    packetCounts(db, season.id, league.timeZone),
    insuranceCertificates(db, league.id),
    names ? packetRosters(db, season.id) : Promise.resolve(null),
  ]);
  const first = held.windows[0];
  const choices = requestChoices(query, {
    teams: inputs.teams,
    weekday: new Date(
      `${first ? localDate(first.startsAt, league.timeZone) : season.startsOn}T12:00:00Z`,
    ).getUTCDay(),
  });
  const sheet = requestSheetFor(choices, season, inputs);
  const boroughOf = new Map(
    held.fields.map((f) => [f.place, boroughAt(FIELDS, f.venue)]),
  );
  const rows = sheet.ok
    ? sheet.value.rows.map((r) => ({
        date: r.date,
        field: r.field,
        start: r.start,
        end: r.end,
        borough: boroughOf.get(r.field) ?? null,
      }))
    : [];
  const insurance = certificates[0] ?? null;
  const packet: PacketInput = {
    league: league.name,
    website: siteOrigin(env.BETTER_AUTH_URL),
    season,
    applications: byBorough(rows),
    counts,
    rosters,
    insurance: insurance && {
      insurer: insurance.insurer,
      policyNumber: insurance.policyNumber,
      startsOn: insurance.startsOn,
      expiresOn: insurance.expiresOn,
    },
  };
  return {
    packet,
    choices,
    sheetOk: sheet.ok,
    namedFields: choices.fieldIds.some((id) =>
      held.fields.some((f) => f.id === id),
    ),
    certificate: insurance,
    query: choicesQuery(choices) + (names ? "&names=1" : ""),
  };
}
