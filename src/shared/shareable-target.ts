export function shareableTargetAllowed(fileSize: number, targetMB: number): boolean {
   return Number.isFinite(fileSize) && fileSize > 0 && Number.isFinite(targetMB) && targetMB > 0 && targetMB * 1_000_000 <= fileSize;
}
