/** Keep token registration and sign-out cleanup ordered, including failed operations. */
export function serialTasks() {
  let pending: Promise<unknown> = Promise.resolve();
  return function run<T>(action: () => Promise<T>): Promise<T> {
    const next = pending.then(action, action);
    pending = next.catch(() => undefined);
    return next;
  };
}
