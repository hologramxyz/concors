# VPS setup wizard

The New VPS dialog has three steps: Server, Customize, Review. Back and the review Edit buttons preserve form values. Step changes move focus to the new heading and reset the body scroll; the footer stays visible on narrow screens.

- Server: name, region, and size, with the existing billing prices. Missing prices cannot be treated as free. Continue is disabled until the server choices are valid.
- Customize: Node defaults to Latest LTS and Docker defaults off. Node includes npm, pnpm, and Yarn. The supported Node choices come from the control-plane catalog. Ask for an SSH public key only when the organization has none.
- Review: server specifications, selected tools, key summary, payment method, and the recurring price. The final action is “Pay <price> & deploy” or “Deploy VPS” for unbilled environments.

Only final confirmation adds an SSH key and creates the machine. Navigating steps, editing choices, and setting up a payment method never deploy a VPS. Existing Stripe confirmation/retry handling is retained. Failed creation keeps the review open with an error and Edit actions.

The Machines page displays optional tool setup status and installed versions, and offers Retry setup after failure. This calls the organization-authorized retry endpoint; it does not create a new VPS. On older control planes without the catalog capability, optional tool controls are omitted and creation retains its original payload.

Deploy the corresponding concors-server PR and its database migration before enabling customization. Keep the shared development preview on main; feature development and local build-based browser checks use a separate checkout.
