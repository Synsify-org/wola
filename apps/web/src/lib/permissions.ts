// Role gates that are shared between a page (what to render) and the server
// action it calls (what to allow). Kept out of the "use server" action files,
// which may only export async functions.

/** Who may CHANGE a rate index (e.g. the BoU CBR). Everyone with the
 *  administration view can SEE it; the CEO and other executives are
 *  deliberately view-only — a rate change reprices every new loan. */
export const RATE_INDEX_EDIT_ROLES = ["cfo", "admin", "org_admin"];
