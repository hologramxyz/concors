# Action button spacing

Use `Button` from `components/ui/button` for action buttons. Primary text actions use the default variant with 28px left/right padding and 8px top/bottom padding. They keep 13px UI text on a 20px line, making a one-line desktop button 38px tall including its border. Icons inside a text button do not reduce its side padding. Long labels can wrap within the available width.

The legacy `default`, `sm`, `xs`, and `lg` text sizes all resolve to this primary-action spacing, so settings actions such as Connect GitHub match New machine, dialog Continue/Save actions, and authentication forms. Use an icon size for square icon-only controls. Secondary actions, embedded controls, and sidebar navigation retain their compact sizing.

The mobile workspace uses the same primary button styles with its existing 44px minimum touch height. Native mobile screens use 28px horizontal and 8px vertical padding for primary buttons while retaining their native typography and 46px minimum touch height.

Account triggers use 8px padding on every side in the expanded desktop sidebar and mobile account footer. Desktop account-menu labels and actions use the same inset. The menu is at least the expanded sidebar width (`--sidebar-width`), including when opened from the collapsed rail; the collapsed trigger stays 32px square.

When adding an action, reuse these defaults instead of introducing local height/padding overrides. Check primary actions with and without icons, loading labels, keyboard focus, narrow dialogs, and both sidebar modes.
