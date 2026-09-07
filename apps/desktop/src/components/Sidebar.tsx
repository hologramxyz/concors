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
          className={`sidebar__item${view === "settings" ? " sidebar__item--active" : ""}`}
          onClick={() => onNavigate("settings")}
        >
          Settings
        </button>
      </div>
    </nav>
  );
}
