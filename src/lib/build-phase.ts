/**
 * For a page with no params, prerendered at build time: its data, or null
 * when the build has no database to read (the CI build job), so the build
 * still passes. Only during `next build`: at request time a failed read
 * throws as usual, so an empty page is never served in place of real data.
 */
export async function readUnlessBuildHasNoDatabase<T>(
  read: () => Promise<T>,
  phase = process.env.NEXT_PHASE,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (phase !== "phase-production-build") throw error;
    console.warn(
      `[build] Prerendered without data: the database could not be read (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
    return null;
  }
}
