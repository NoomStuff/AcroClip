import { Component } from "react";
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Empty } from "./ui";

/**
 * Keeps a page's render error inside that page. Without it React unmounts the whole window and
 * leaves it blank, while capture keeps running behind it. The error still reaches the app log
 * through the root's `onCaughtError`.
 */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
   override state = { failed: false };

   static getDerivedStateFromError(): { failed: boolean } {
      return { failed: true };
   }

   override render(): ReactNode {
      if (!this.state.failed) return this.props.children;
      return (
         <Empty
            icon={<TriangleAlert size={38} />}
            title="This page ran into a problem"
            detail="Capture keeps running. Exporting logs from Settings helps us fix it."
         >
            <Button onClick={() => this.setState({ failed: false })}>Reload page</Button>
         </Empty>
      );
   }
}
