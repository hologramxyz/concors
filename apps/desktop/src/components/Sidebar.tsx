export type View = "home" | "settings";

interface SidebarProps {
  readonly view: View;
  readonly onNavigate: (view: View) => void;
}

/** Navigation placeholder. Real sections (agents, projects, daemons) arrive with the features. */
export function Sidebar({ view, onNavigate }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">
          ◆
        </span>
        <span>Concors</span>
      </div>

      <ul className="sidebar__nav">
        <li>
          <button
            type="button"
            className={`sidebar__item${view === "home" ? " sidebar__item--active" : ""}`}
            onClick={() => onNavigate("home")}
          >
            Home
          </button>
        </li>
        <li>
          <button type="button" className="sidebar__item" disabled title="Coming soon">
            Agents
          </button>
        </li>
        <li>
          <button type="button" className="sidebar__item" disabled title="Coming soon">
            Projects
          </button>
        </li>
        <li>
          <button type="button" className="sidebar__item" disabled title="Coming soon">
            Daemons
          </button>
        </li>
      </ul>

      <div className="sidebar__footer">
        <button
          type="button"
          className={`sidebar__item sidebar__item--icon${view === "settings" ? " sidebar__item--active" : ""}`}
          onClick={() => onNavigate("settings")}
          aria-label="Settings"
          title="Settings"
        >
          <GearIcon />
        </button>
      </div>
    </nav>
  );
}

function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
