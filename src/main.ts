// MikeFiles Drive — entry. Session check via /auth/me (httpOnly cookie): signed
// out -> landing; signed in -> the drive.
import "./styles.css";
import { me } from "./lib/api";
import { renderLanding } from "./pages/landing";
import { renderDrive } from "./pages/drive";

const app = document.getElementById("app")!;

async function boot(): Promise<void> {
  try {
    const session = await me();
    if (session.authenticated && session.user) {
      renderDrive(app, session.user);
    } else {
      renderLanding(app);
    }
  } catch {
    renderLanding(app);
  }
}

boot();
