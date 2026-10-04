import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import ErrorBoundary from "./components/ErrorBoundary";
import "@fontsource/alegreya/latin-400.css";
import "@fontsource/alegreya/latin-700.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<ErrorBoundary><App /></ErrorBoundary>);
