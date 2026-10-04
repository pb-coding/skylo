import { Component, ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode; canLeaveSession?: boolean };
type State = { failed: boolean };

/** Keep the rest of the interface usable when a scene or asset fails. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Skylo konnte die Ansicht nicht laden", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="p-6 text-center text-white bg-teal-900">
          <h2 className="text-2xl font-bold mb-2">Die Spielansicht konnte nicht geladen werden.</h2>
          <p className="mb-4">
            Prüfe deine Verbindung. {this.props.canLeaveSession
              ? "Du kannst die Session verlassen oder die Seite neu laden."
              : "Bitte lade die Seite neu."}
          </p>
          <p className="mb-4 text-sm">Beim Neuladen verlässt du die laufende Partie.</p>
          <button className="border rounded-lg px-4 py-2" onClick={() => window.location.reload()}>
            Seite neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
