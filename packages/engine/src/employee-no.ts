// An employee number made up by Wola (not issued by the organisation) starts with this. Used when a
// client's staff list has a person with no number: they are loaded under TEMP-001, TEMP-002 ... and
// HR is warned until the real number is entered. One definition for the database, the server and the screens.
export const PROVISIONAL_EMPLOYEE_NO_PREFIX = "TEMP-";
export const isProvisionalEmployeeNo = (no: string) => no.startsWith(PROVISIONAL_EMPLOYEE_NO_PREFIX);
