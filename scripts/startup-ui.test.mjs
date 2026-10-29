import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const dialogSource = await readFile(new URL("../src/components/ui/AppDialog.tsx", import.meta.url), "utf8");
const parse = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = parse("App.tsx", appSource);
const dialog = parse("AppDialog.tsx", dialogSource);
const appFunction = app.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "App");

function startupEffect(functionName) {
  const statement = appFunction.body.statements.find((node) => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(app) === "useEffect"
    && node.expression.arguments[0].body?.statements?.some((child) => ts.isFunctionDeclaration(child) && child.name?.text === functionName));
  assert.ok(statement, `Missing startup effect: ${functionName}`);
  return statement.expression;
}

const bootstrapEffect = startupEffect("loadBootstrap");
const permissionEffect = startupEffect("loadPermissionConfig");
const reactSources = [];
for (const name of ["react", "react-dom"]) {
  reactSources.push(await readFile(join(dirname(require.resolve(`${name}/package.json`)), "umd", `${name}.development.js`), "utf8"));
}

function startupFixture({ omitPeopleDependency = false, delayedPermissions = false } = {}) {
  let resolvePermissions;
  const permissionConfig = { permissionItems: [], rolePermissionMaps: [], personalPermissionExceptions: [{ id: "synthetic-deny" }] };
  const snapshot = { people: [{ id: "synthetic" }], stations: [], qualifications: [] };
  const noop = () => {};
  const services = {
    bootstrapRequests: 0, permissionRequests: 0, applied: [], renders: [], errors: [],
    loginBootstrapRef: { current: null },
    sanitizeBootstrapData: (value) => value,
    compareBootstrap: () => [],
    mergePermissionItemsWithSaved: (value) => value,
    buildRolePermissionMapsFromSaved: (value) => value,
    fetchGasBootstrapData: async () => { services.bootstrapRequests++; return snapshot; },
    fetchGasPermissionConfig: async () => {
      services.permissionRequests++;
      return delayedPermissions ? new Promise((resolve) => { resolvePermissions = resolve; }) : permissionConfig;
    },
    setBootstrapError: noop, setSyncChanges: noop, setPage: noop, setFlashMessage: noop, setLastLoadedAt: noop,
    setPermissionItemStates: noop, setRolePermissionMapStates: noop,
    setPersonalPermissionExceptions: (value) => services.applied.push(value),
  };
  const context = vm.createContext({
    setTimeout, clearTimeout, setImmediate, clearImmediate, queueMicrotask, performance, services,
    console: { ...console, warn: (...args) => services.errors.push(args) },
    fetch: () => { throw new Error("Network is forbidden in startup UI tests"); },
  });
  for (const source of reactSources) vm.runInContext(source, context);
  assert.match(context.React.version, /^18\./, "This regression depends on React 18 batching");

  // A null-rendering probe needs only a root event target, not a layout/DOM emulator.
  const document = { nodeType: 9, addEventListener: noop, removeEventListener: noop, activeElement: null, body: null };
  context.document = document;
  context.window = { document, HTMLIFrameElement: class {} };
  context.container = { nodeType: 1, tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document,
    addEventListener: noop, removeEventListener: noop, textContent: "" };

  let effect = permissionEffect;
  if (omitPeopleDependency) {
    const dependencies = permissionEffect.arguments[1];
    assert.ok(ts.isArrayLiteralExpression(dependencies));
    effect = ts.factory.updateCallExpression(permissionEffect, permissionEffect.expression, permissionEffect.typeArguments, [
      permissionEffect.arguments[0], ts.factory.updateArrayLiteralExpression(dependencies,
        dependencies.elements.filter((node) => node.getText(app) !== "data.people.length")),
    ]);
  }
  const print = (node) => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, app);
  const code = ts.transpileModule(`
    const { useEffect, useRef, useState } = React;
    const root = ReactDOM.createRoot(container);
    function StartupProbe({ currentUser }) {
      const [data, setData] = useState({ people: [], qualifications: [] });
      const [loading, setLoading] = useState(false);
      const dataRef = useRef(data);
      dataRef.current = data;
      const bootstrapRetryKey = 0;
      const { loginBootstrapRef, sanitizeBootstrapData, compareBootstrap, fetchGasBootstrapData,
        fetchGasPermissionConfig, mergePermissionItemsWithSaved, buildRolePermissionMapsFromSaved,
        setBootstrapError, setSyncChanges, setPage, setFlashMessage, setLastLoadedAt,
        setPermissionItemStates, setRolePermissionMapStates, setPersonalPermissionExceptions } = services;
      ${print(bootstrapEffect)};
      ${print(effect)};
      services.renders.push({ people: data.people.length, loading });
      return null;
    }
    globalThis.renderStartup = (currentUser) => root.render(React.createElement(StartupProbe, { currentUser }));
    globalThis.unmountStartup = () => root.unmount();
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(code, context);
  return { services, snapshot, render: context.renderStartup, close: context.unmountStartup,
    resolvePermissions: () => resolvePermissions(permissionConfig) };
}

async function drainReact() {
  for (let turn = 0; turn < 8; turn++) await new Promise(setImmediate);
}

test("React 18 inline login/restore loads saved permissions once without a loading transition", async (t) => {
  const f = startupFixture();
  t.after(f.close);
  f.render(null);
  await drainReact();
  const user = { id: "synthetic" };
  f.services.loginBootstrapRef.current = { userId: user.id, data: f.snapshot };
  f.render(user);
  await drainReact();
  assert.equal(f.services.bootstrapRequests, 0);
  assert.equal(f.services.loginBootstrapRef.current, null);
  assert.equal(f.services.permissionRequests, 1);
  assert.equal(f.services.applied[0]?.[0]?.id, "synthetic-deny");
  assert.ok(f.services.renders.every((render) => render.loading === false), "true/false loading updates must be batched");
  assert.equal(f.services.renders.at(-1).people, 1);
  f.render(user);
  await drainReact();
  assert.equal(f.services.permissionRequests, 1, "An unrelated render must not refetch permissions");
  assert.ok(f.services.renders.length <= 5, "Startup must settle without a render loop");
  assert.equal(f.services.errors.length, 0);
});

test("negative control reproduces missing permissions when the people dependency is removed", async (t) => {
  const f = startupFixture({ omitPeopleDependency: true });
  t.after(f.close);
  f.render(null);
  await drainReact();
  f.services.loginBootstrapRef.current = { userId: "synthetic", data: f.snapshot };
  f.render({ id: "synthetic" });
  await drainReact();
  assert.equal(f.services.renders.at(-1).people, 1);
  assert.equal(f.services.permissionRequests, 0);
});

test("network bootstrap fallback still loads permissions after core data arrives", async (t) => {
  const f = startupFixture();
  t.after(f.close);
  f.render(null);
  await drainReact();
  f.render({ id: "synthetic" });
  await drainReact();
  assert.equal(f.services.bootstrapRequests, 1);
  assert.equal(f.services.permissionRequests, 1);
  assert.equal(f.services.applied.length, 1);
  assert.equal(f.services.errors.length, 0);
});

test("a permission response arriving after logout cannot update saved permission state", async (t) => {
  const f = startupFixture({ delayedPermissions: true });
  t.after(f.close);
  f.render(null);
  await drainReact();
  f.services.loginBootstrapRef.current = { userId: "synthetic", data: f.snapshot };
  f.render({ id: "synthetic" });
  await drainReact();
  assert.equal(f.services.permissionRequests, 1);
  f.render(null);
  await drainReact();
  f.resolvePermissions();
  await drainReact();
  assert.equal(f.services.applied.length, 0);
});

const helper = dialog.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "visibleDialogControls");
assert.ok(helper, "Missing visibleDialogControls helper");
const helperCode = ts.transpileModule(helper.getText(dialog), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const visibleDialogControls = vm.runInNewContext(`${helperCode}; visibleDialogControls;`);

// DOM-shaped nodes deliberately retain layout rects inside closed details, as Chromium does.
function element(tag, parentElement = null, attributes = {}) {
  const node = { tag, parentElement, children: [], open: false, rects: 1, ...attributes,
    getClientRects() { return Array.from({ length: this.rects }, () => ({})); },
    closest(selector) {
      assert.ok(["details", '[inert], [aria-hidden="true"]'].includes(selector));
      for (let ancestor = this; ancestor; ancestor = ancestor.parentElement) {
        if (selector === "details" ? ancestor.tag === "details" : ancestor.inert || ancestor.ariaHidden) return ancestor;
      }
      return null;
    },
    querySelector(selector) {
      assert.equal(selector, ":scope > summary");
      return this.children.find((child) => child.tag === "summary") || null;
    },
    contains(candidate) {
      for (let ancestor = candidate; ancestor; ancestor = ancestor.parentElement) if (ancestor === this) return true;
      return false;
    },
  };
  parentElement?.children.push(node);
  return node;
}

function focusFixture() {
  const panel = element("div");
  const outer = element("details", panel);
  const summary = element("summary", outer);
  const summaryChild = element("span", summary);
  const candidate = element("button", outer);
  const inner = element("details", outer, { open: true });
  const innerSummary = element("summary", inner);
  const innerCandidate = element("button", inner);
  const footer = element("button", panel);
  const controls = [summary, summaryChild, candidate, innerSummary, innerCandidate, footer];
  panel.querySelectorAll = (selector) => {
    assert.ok(selector.split(",").map((item) => item.trim()).includes("summary"), "Summaries must enter the focus order");
    return controls;
  };
  return { panel, outer, summary, summaryChild, candidate, inner, innerSummary, innerCandidate, footer, controls };
}

test("closed details retains its own summary but excludes layout-bearing candidates and nested summaries", () => {
  const f = focusFixture();
  assert.equal(f.candidate.getClientRects().length, 1);
  assert.deepEqual(Array.from(visibleDialogControls(f.panel)), [f.summary, f.summaryChild, f.footer]);
});

test("every details ancestor must be open unless the control belongs to its own summary", () => {
  const f = focusFixture();
  f.outer.open = true;
  assert.deepEqual(Array.from(visibleDialogControls(f.panel)), f.controls);
  f.inner.open = false;
  assert.deepEqual(Array.from(visibleDialogControls(f.panel)), [f.summary, f.summaryChild, f.candidate, f.innerSummary, f.footer]);
});

test("focus filtering preserves inert, aria-hidden, missing-layout and null-panel exclusions", () => {
  const f = focusFixture();
  f.outer.open = true;
  f.outer.inert = true;
  assert.deepEqual(Array.from(visibleDialogControls(f.panel)), [f.footer]);
  f.outer.inert = false;
  f.outer.ariaHidden = true;
  assert.deepEqual(Array.from(visibleDialogControls(f.panel)), [f.footer]);
  f.outer.ariaHidden = false;
  f.footer.rects = 0;
  assert.deepEqual(Array.from(visibleDialogControls(f.panel)), f.controls.slice(0, -1));
  assert.equal(visibleDialogControls(null).length, 0);
});
