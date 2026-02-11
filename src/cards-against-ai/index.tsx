import { createRoot } from "react-dom/client";
import App from "./App";

const container = document.getElementById("cards-against-ai-root");
if (container) {
  createRoot(container).render(<App />);
} else {
  console.warn("Cards Against AI root element not found.");
}

export default App;
