import { spawn } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { CodexAppServer } from "./app-server.ts";

const fixture = `
const readline = require('node:readline');
let initialized = false;
const send = frame => process.stdout.write(JSON.stringify(frame)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
  const frame = JSON.parse(line);
  if(frame.id==='approval') {send({method:'approval/response',params:frame});return;}
  if(frame.method==='initialize') {send({id:frame.id,result:{userAgent:'test'}});return;}
  if(frame.method==='initialized') {initialized=true;return;}
  if(!initialized) {send({id:frame.id,error:{code:-1,message:'Not initialized'}});return;}
  switch(frame.method) {
    case 'echo':setTimeout(()=>send({id:frame.id,result:frame.params}),frame.params.delay || 0);break;
    case 'notify': {
      const data=Buffer.from(JSON.stringify({method:'item/agentMessage/delta',params:{delta:'hello 🌍'}})+'\\n');
      const at=data.indexOf(Buffer.from('🌍'))+2;
      process.stdout.write(data.subarray(0,at));
      setTimeout(()=>{process.stdout.write(data.subarray(at));send({id:frame.id,result:{}});},5);break;
    }
    case 'approval':send({id:'approval',method:'item/commandExecution/requestApproval',params:{command:'test'}});send({id:frame.id,result:{}});break;
    case 'hang':break;
    case 'exit':process.exit(2);break;
    case 'bad':process.stdout.write('not-json\\n');break;
    case 'large':process.stdout.write('x'.repeat(2*1024*1024+1));break;
  }
});
`;
const clients: CodexAppServer[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});
function open(handler?: ConstructorParameters<typeof CodexAppServer>[1]) {
  const client = new CodexAppServer(
    spawn(process.execPath, ["-e", fixture], { stdio: "pipe" }),
    handler,
  );
  clients.push(client);
  return client;
}
it("initializes once, correlates out-of-order replies and decodes split UTF-8 notifications", async () => {
  const client = open();
  await expect(client.request("echo")).rejects.toThrow("Initialize");
  await Promise.all([client.initialize(), client.initialize()]);
  expect(
    await Promise.all([
      client.request("echo", { delay: 20, value: "first" }),
      client.request("echo", { value: "second" }),
    ]),
  ).toEqual([{ delay: 20, value: "first" }, { value: "second" }]);
  const events: unknown[] = [];
  client.onNotification((_method, params) => events.push(params));
  await client.request("notify");
  expect(events).toContainEqual({ delta: "hello 🌍" });
});
it("passes input requests to the host and never implicitly approves an unknown request", async () => {
  const client = open();
  const events: unknown[] = [];
  client.onNotification((_method, params) => events.push(params));
  await client.initialize();
  await client.request("approval");
  await expect
    .poll(() => events)
    .toContainEqual({
      id: "approval",
      error: {
        code: -32601,
        message: "Unsupported Codex request: item/commandExecution/requestApproval",
      },
    });
  const handled = open(async (method, params) => {
    expect(method).toBe("item/commandExecution/requestApproval");
    expect(params).toEqual({ command: "test" });
    return { decision: "decline" };
  });
  const replies: unknown[] = [];
  handled.onNotification((_method, params) => replies.push(params));
  await handled.initialize();
  await handled.request("approval");
  await expect
    .poll(() => replies)
    .toContainEqual({ id: "approval", result: { decision: "decline" } });
});
it("does not replay timed out requests and rejects all pending work on exit", async () => {
  const client = open();
  await client.initialize();
  await expect(client.request("hang", {}, 10)).rejects.toThrow("outcome is unknown");
  expect(await client.request("echo", { value: "still connected" })).toEqual({
    value: "still connected",
  });
  const pending = client.request("hang");
  const exiting = client.request("exit");
  await expect(Promise.all([pending, exiting])).rejects.toThrow("exited");
});
it.each(["bad", "large"])("fails closed on %s frames", async (method) => {
  const client = open();
  await client.initialize();
  await expect(client.request(method)).rejects.toThrow(method === "bad" ? "Invalid" : "2 MiB");
});

it("rejects auto-review when the provider does not report a supported version", async () => {
  const client = open();
  await client.initialize();
  await expect(client.request("turn/start", { approvalsReviewer: "auto_review" })).rejects.toThrow(
    "0.115.0",
  );
  expect(await client.request("echo", { value: "still connected" })).toEqual({
    value: "still connected",
  });
});
