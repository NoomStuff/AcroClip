/** A clip save was attempted and failed, rather than rejected by an idle-state guard. */
export class SaveFailure extends Error {
   override readonly name = "SaveFailure";
}
