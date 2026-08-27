/** Joins class names, dropping falsy values. Deliberately not `clsx` —
 *  this is the entire feature we use and it costs one dependency otherwise. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
