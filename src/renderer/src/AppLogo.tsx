import icon from "../../../build/icon.svg?no-inline";

/** App branding uses the exact asset shipped to the desktop, tray and installers. */
export function AppLogo({ size = 24 }: { size?: number }) {
   return <img className="app-logo" src={icon} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
