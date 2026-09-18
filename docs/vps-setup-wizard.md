# VPS setup wizard

The New VPS dialog has three steps: Server, Customize, Review. Back and the review Edit buttons preserve form values. Step changes move focus to the new heading and reset the body scroll; the footer stays visible on narrow screens.

- Server: name, region, and size, with the existing billing prices. Missing prices cannot be treated as free. Continue is disabled until the server choices are valid.
- Customize: a responsive logo card picker for Node.js, Python, Go, Rust, and Docker. Node defaults to Latest LTS; the other tools default off. Node includes npm/pnpm/Yarn, Python includes uv, and Rust includes Cargo. The catalog controls which additional tools are offered. Never ask for an SSH key: Concors manages the machine with its own key. Omit preinstalled-tool notices.
- Review: server specifications, selected tools, payment method, and the recurring price. The final action is “Pay <price> & deploy” or “Deploy VPS” for unbilled environments.

Only final confirmation creates the machine. Navigating steps, editing choices, and setting up a payment method never deploy a VPS. Existing Stripe confirmation/retry handling is retained. Failed creation keeps the review open with an error and Edit actions.

Optional tools install after deployment without adding a persistent setup-status section to the machine card. On older control planes without the catalog capability, optional tool controls are omitted and creation retains its original payload.

Deploy the corresponding concors-server PR and its database migration before enabling customization. Keep the shared development preview on main; feature development and local build-based browser checks use a separate checkout.

## SSH access

Creating a VPS never involves SSH keys. Using a machine in Concors — terminals, agents, files — goes
through its daemon, and Concors reaches the server with its own management key. SSH keys are only for
connecting from your own terminal:

- **Desktop app:** the machine card's collapsed **Advanced** section offers **Set up SSH on this computer**. It creates
  `~/.ssh/concors_ed25519` with the system's `ssh-keygen` if that file does not exist (an existing
  key is never replaced), registers the public key under the computer's name, and then shows
  `ssh -i <key path> ubuntu@<address>` with a copy button. The server pushes the key to running
  machines within seconds. The private key never leaves the computer, and each device has its own
  key, so a lost laptop can be removed on its own.
- **Browser and mobile:** they cannot hold a private key, so the card shows the plain command only
  once the person has a key, and otherwise points to **Settings → SSH keys**.
- **Settings → SSH keys** lists each key with **This computer** marking the current device, offers
  the same setup, and still accepts a key pasted by hand (**Add your own key**).
