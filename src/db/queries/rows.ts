/** A row that must exist, such as the first row of an insert's `returning`. */
export function required<Row>(row: Row | null | undefined, what: string): Row {
  if (row === undefined || row === null)
    throw new Error(`Expected a ${what} row, got none`);
  return row;
}
