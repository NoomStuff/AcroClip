import { lazy, memo } from "react";
import type { ComponentType } from "react";

/**
 * A page that loads after first paint. Once preloaded it renders directly, so
 * opening it never suspends, and React never throttles revealing its content.
 */
export function preloadedPage<P extends object>(load: () => Promise<ComponentType<P>>) {
   let loaded: ComponentType<P> | undefined;
   let pending: Promise<void> | undefined;
   const preload = () =>
      (pending ??= load().then((component) => {
         loaded = component;
      }));
   const Pending = lazy(async () => {
      await preload();
      return { default: loaded! };
   });
   const Page = memo(function Page(props: P) {
      const Component = loaded ?? Pending;
      return <Component {...props} />;
   });
   return { Page, preload };
}
