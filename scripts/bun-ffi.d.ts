/** The part of Bun's FFI that windows-desktop.ts uses. The project doesn't load Bun's own types. */
declare module "bun:ffi" {
   export type Pointer = number & { readonly __pointer: unique symbol };
   type Type = "ptr" | "i32" | "u32";
   type Value<T extends Type> = T extends "ptr" ? Pointer | null : number;
   interface Signature {
      readonly args: readonly Type[];
      readonly returns: Type;
   }
   type Values<Args extends readonly Type[]> = { -readonly [I in keyof Args]: Args[I] extends Type ? Value<Args[I]> : never };
   type Call<Args extends readonly Type[], Returns extends Type> = (...args: Values<Args>) => Value<Returns>;
   export function dlopen<const Symbols extends Record<string, Signature>>(
      path: string,
      symbols: Symbols
   ): { readonly symbols: { readonly [Name in keyof Symbols]: Call<Symbols[Name]["args"], Symbols[Name]["returns"]> }; close(): void };
   export function ptr(view: ArrayBufferView): Pointer;
}
