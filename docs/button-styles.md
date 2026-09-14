# Action button spacing

Use `Button` from `components/ui/button` for all text actions. Every color variant uses 8px left/right padding, 4px top/bottom padding, and 13px UI text on an 18px line. A one-line desktop button is 28px tall including its border. Icons do not reduce side padding; long labels can wrap within the available width.

The legacy `default`, `sm`, `xs`, and `lg` text sizes resolve to these same dimensions. Filled, outline, secondary, ghost, destructive, and link actions share their spacing. This includes New machine, Add provider, Interface theme, Copy theme instructions, notification tests, Connect GitHub, and dialog actions. Use an icon size for square icon-only controls. Sidebar navigation and specialized list/menu rows retain their own layout.

The mobile workspace uses the same text button styles with its existing 44px minimum touch height. Native mobile buttons share 8px horizontal and 4px vertical padding across variants while retaining native typography and the 46px minimum touch height.

Account triggers use 8px padding on every side in the expanded desktop sidebar and mobile account footer. Desktop account-menu labels and actions use the same inset. Account and machine menus share a width of `calc(var(--sidebar-width) - 16px)`: 200px, inset within the 216px expanded sidebar. They retain this readable width when opened from the collapsed rail; the collapsed trigger stays 32px square.

When adding an action, reuse these defaults instead of introducing local height/padding overrides. Check text actions with and without icons, loading labels, keyboard focus, narrow dialogs, and both sidebar modes.
